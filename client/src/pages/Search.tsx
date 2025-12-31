import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { DocumentTypeIcon, getDocumentTypeLabel } from "@/components/DocumentTypeIcon";
import { apiRequest } from "@/lib/queryClient";
import { Search as SearchIcon, MessageSquare, FileText, ExternalLink, Send, Sparkles, History, BookOpen } from "lucide-react";
import type { Document, QaHistory } from "@shared/schema";

interface SearchResult {
  documentId: number;
  documentTitle: string;
  documentType: string | null;
  pageNumber: number | null;
  chunkText: string;
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
}

interface QAResponse {
  answer: string;
  citations: Array<{
    documentId: number;
    documentTitle: string;
    pageNumber?: number;
    excerpt: string;
  }>;
  insufficientEvidence: boolean;
}

export default function SearchPage() {
  const [activeTab, setActiveTab] = useState("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [qaResponse, setQaResponse] = useState<QAResponse | null>(null);

  const { data: qaHistory } = useQuery<QaHistory[]>({
    queryKey: ["/api/qa/history"],
  });

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const response = await apiRequest("POST", "/api/search", { query });
      return response as unknown as SearchResponse;
    },
    onSuccess: (data) => {
      setSearchResults(data.results || []);
    },
  });

  const qaMutation = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiRequest("POST", "/api/qa/ask", { question });
      return response as unknown as QAResponse;
    },
    onSuccess: (data) => {
      setQaResponse(data);
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchMutation.mutate(searchQuery);
    }
  };

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim()) {
      setQaResponse(null); // Clear old response to force fresh render
      qaMutation.mutate(question);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Search & Ask AI</h1>
        <p className="text-sm text-muted-foreground">
          Search your documents or ask questions with AI-powered citations
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="search" data-testid="tab-search">
            <SearchIcon className="h-4 w-4 mr-2" />
            Search
          </TabsTrigger>
          <TabsTrigger value="ask" data-testid="tab-ask">
            <MessageSquare className="h-4 w-4 mr-2" />
            Ask AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Document Search</CardTitle>
              <CardDescription>
                Search across all your documents using keywords or semantic queries
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search for topics, companies, metrics..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-search"
                  />
                </div>
                <Button type="submit" disabled={searchMutation.isPending} data-testid="button-search">
                  {searchMutation.isPending ? "Searching..." : "Search"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {searchMutation.isPending && (
            <LoadingSpinner text="Searching documents..." />
          )}

          {searchResults.length > 0 && !searchMutation.isPending && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Results ({searchResults.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4">
                    {searchResults.map((result, index) => (
                      <SearchResultCard key={`${result.documentId}-${index}`} result={result} />
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {searchResults.length === 0 && !searchMutation.isPending && searchQuery && (
            <EmptyState
              icon={SearchIcon}
              title="No results found"
              description="Try different keywords or a broader search query"
            />
          )}
        </TabsContent>

        <TabsContent value="ask" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Ask AI
              </CardTitle>
              <CardDescription>
                Ask questions about your documents and get answers with citations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAsk} className="space-y-4">
                <Textarea
                  placeholder="Ask a question about your documents... e.g., 'What are the key risks mentioned in the annual reports?'"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={3}
                  className="resize-none"
                  data-testid="input-question"
                />
                <div className="flex justify-end">
                  <Button type="submit" disabled={qaMutation.isPending} data-testid="button-ask">
                    {qaMutation.isPending ? (
                      <>Thinking...</>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Ask Question
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {qaMutation.isPending && (
            <Card>
              <CardContent className="py-8">
                <LoadingSpinner text="Analyzing documents and generating answer..." />
              </CardContent>
            </Card>
          )}

          {qaResponse && !qaMutation.isPending && (
            <Card className="border-primary/20 shadow-sm min-h-[200px] overflow-visible">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  Answer
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 opacity-100 visible">
                <div className="prose prose-sm max-w-none dark:prose-invert block" data-testid="text-answer">
                  {qaResponse.insufficientEvidence ? (
                    <div className="flex flex-col gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 block mb-4">
                      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 font-medium">
                        <Sparkles className="h-4 w-4" />
                        Insufficient Information
                      </div>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {qaResponse.answer || "I cannot answer this question based on the uploaded documents."}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-muted/30 p-4 rounded-lg border border-border block mb-4">
                      <p className="whitespace-pre-wrap leading-relaxed text-foreground block">
                        {qaResponse.answer}
                      </p>
                    </div>
                  )}
                </div>

                {qaResponse.citations && qaResponse.citations.length > 0 && (
                  <div className="mt-8 space-y-4 block">
                    <Separator className="my-6" />
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                      <FileText className="h-4 w-4" />
                      Sources ({qaResponse.citations.length})
                    </h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {qaResponse.citations.map((citation, index) => (
                        <CitationCard key={index} citation={citation} />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {qaHistory && qaHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Recent Questions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-3">
                    {qaHistory.slice(0, 5).map((qa) => (
                      <div 
                        key={qa.id} 
                        className="p-3 rounded-lg border hover-elevate cursor-pointer"
                        onClick={() => {
                          setQuestion(qa.question);
                          setQaResponse({
                            answer: qa.answer,
                            citations: qa.citations || [],
                            insufficientEvidence: false,
                          });
                        }}
                      >
                        <p className="text-sm font-medium truncate">{qa.question}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {qa.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <Link href={`/documents/${result.documentId}${result.pageNumber ? `?page=${result.pageNumber}` : ""}`}>
      <div className="p-4 rounded-lg border hover-elevate cursor-pointer" data-testid={`search-result-${result.documentId}`}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted flex-shrink-0">
            <DocumentTypeIcon type={result.documentType} className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-medium truncate">{result.documentTitle}</h4>
              {result.pageNumber && (
                <Badge variant="outline" className="text-xs">
                  Page {result.pageNumber}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
              {result.chunkText}
            </p>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </div>
      </div>
    </Link>
  );
}

function CitationCard({ citation }: { citation: QAResponse["citations"][0] }) {
  return (
    <Link href={`/documents/${citation.documentId}${citation.pageNumber ? `?page=${citation.pageNumber}` : ""}`}>
      <div className="p-3 rounded-lg border bg-card hover-elevate cursor-pointer h-full transition-all" data-testid={`citation-${citation.documentId}`}>
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold truncate">{citation.documentTitle}</span>
          {citation.pageNumber && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              P. {citation.pageNumber}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 italic border-l-2 border-primary/20 pl-2">
          "{citation.excerpt}"
        </p>
      </div>
    </Link>
  );
}
