export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  lastModified: string;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  folderCount: number;
  fileCount: number;
  totalSize: number;
}

export interface SearchResult {
  query: string;
  path: string;
  results: FileEntry[];
}

export class ApiClient {
  constructor(private readonly baseUrl: string = '/api/files') {}

  async browse(path: string): Promise<BrowseResult> {
    return this.request<BrowseResult>(
      `${this.baseUrl}/browse?path=${encodeURIComponent(path)}`,
      { method: 'GET' }
    );
  }

  async search(query: string, path: string): Promise<SearchResult> {
    return this.request<SearchResult>(
      `${this.baseUrl}/search?query=${encodeURIComponent(query)}&path=${encodeURIComponent(path)}`,
      { method: 'GET' }
    );
  }

  async upload(path: string, file: File): Promise<{ path: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request<{ path: string }>(
      `${this.baseUrl}/upload?path=${encodeURIComponent(path)}`,
      { method: 'POST', body: formData }
    );
  }

  async delete(path: string): Promise<void> {
    await this.request<unknown>(
      `${this.baseUrl}/delete?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' }
    );
  }

  async move(source: string, destination: string): Promise<void> {
    await this.request<unknown>(
      `${this.baseUrl}/move`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: source, destinationPath: destination }),
      }
    );
  }

  async copy(source: string, destination: string): Promise<void> {
    await this.request<unknown>(
      `${this.baseUrl}/copy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: source, destinationPath: destination }),
      }
    );
  }

  downloadUrl(path: string): string {
    return `${this.baseUrl}/download?path=${encodeURIComponent(path)}`;
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new Error(res.status + ': ' + await res.text());
    }
    return await res.json() as T;
  }
}
