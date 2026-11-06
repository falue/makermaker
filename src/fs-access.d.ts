// File System Access API pickers (Chromium); not yet part of lib.dom.
interface FilePickerOptions {
  types?: { description?: string; accept: Record<string, string[]> }[];
  suggestedName?: string;
  multiple?: boolean;
}

interface Window {
  showOpenFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle>;
  showDirectoryPicker?(options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle | 'documents' | 'downloads' | 'pictures' }): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
  queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
