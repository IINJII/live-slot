export type CreativeType = 'image' | 'gif' | 'video' | 'html5';

export interface Creative {
  fileId: string;
  fileName: string;
  fileType: CreativeType;
  mimeType: string;
  width: number;
  height: number;
  tempUrl: string;
  size: number;
}

export interface AdSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  selector: string;
  iabName: string;
  isVisible: boolean;
}

export interface DetectionResult {
  url: string;
  slots: AdSlot[];
  screenshotBase64: string;
  pageWidth: number;
  pageHeight: number;
  detectedAt: string;
}

export interface PreviewResult {
  slotId: string;
  compositeImageBase64: string;
  creativeFileId: string;
}

export interface UploadResult {
  fileId: string;
  fileName: string;
  fileType: CreativeType;
  mimeType: string;
  width: number;
  height: number;
  tempUrl: string;
  size: number;
}

export type AppStep = 'upload' | 'detect' | 'preview';
