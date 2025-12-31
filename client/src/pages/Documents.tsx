import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/StatusBadge";
import { DocumentTypeIcon, getDocumentTypeLabel } from "@/components/DocumentTypeIcon";
import { EmptyState } from "@/components/EmptyState";
import { Search, FileText, Upload, Calendar, Filter, Eye, Trash2 } from "lucide-react";
import { documentTypes, type Document, type DocumentType, type ProcessingStatus } from "@shared/schema";
import { format } from "date-fns";

interface DocumentsResponse {
  documents: Document[];
  total: number;
}

export default function DocumentsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Build query URL with parameters
  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (searchQuery) params.set("search", searchQuery);
    return `/api/documents${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const { data, isLoading } = useQuery<DocumentsResponse>({
    queryKey: ["/api/documents", typeFilter, statusFilter, searchQuery],
    queryFn: async () => {
      const res = await fetch(buildQueryUrl(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });

  const documents = data?.documents || [];
  const filteredDocs = documents.filter((doc) => {
    const matchesSearch = !searchQuery || 
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.originalFilename.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || doc.documentType === typeFilter;
    const matchesStatus = statusFilter === "all" || doc.processingStatus === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Browse and manage your research documents
          </p>
        </div>
        <Link href="/upload">
          <Button data-testid="button-upload-new">
            <Upload className="h-4 w-4 mr-2" />
            Upload New
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-documents"
              />
            </div>
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Document Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {documentTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {getDocumentTypeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <DocumentsSkeleton />
          ) : filteredDocs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents found"
              description={searchQuery || typeFilter !== "all" || statusFilter !== "all"
                ? "Try adjusting your filters or search terms"
                : "Upload your first document to get started with AI-powered analysis"
              }
              actionLabel={!searchQuery && typeFilter === "all" && statusFilter === "all" ? "Upload Document" : undefined}
              onAction={() => window.location.href = "/upload"}
            />
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-3">
                {filteredDocs.map((doc) => (
                  <DocumentCard key={doc.id} document={doc} />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentCard({ document: doc }: { document: Document }) {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <Link href={`/documents/${doc.id}`}>
      <div 
        className="flex items-center gap-4 p-4 rounded-lg border hover-elevate cursor-pointer"
        data-testid={`card-document-${doc.id}`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted flex-shrink-0">
          <DocumentTypeIcon type={doc.documentType} className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium truncate" data-testid={`text-doc-title-${doc.id}`}>
              {doc.title}
            </h3>
            <StatusBadge status={doc.processingStatus} />
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(doc.uploadDate), "MMM d, yyyy")}
            </span>
            <span>{formatBytes(doc.fileSizeBytes)}</span>
            {doc.documentType && (
              <Badge variant="outline" className="text-xs">
                {getDocumentTypeLabel(doc.documentType)}
              </Badge>
            )}
            {doc.pageCount && (
              <span>{doc.pageCount} pages</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" size="icon" asChild>
            <span>
              <Eye className="h-4 w-4" />
            </span>
          </Button>
        </div>
      </div>
    </Link>
  );
}

function DocumentsSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-lg border">
          <Skeleton className="h-12 w-12 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      ))}
    </div>
  );
}
