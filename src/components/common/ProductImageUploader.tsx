import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, RefreshCw, Trash2, Upload, Video, X } from 'lucide-react';
import { api } from '../../services/api';
import {
  compressCanvasVideoFrame,
  compressImageFileForUpload,
} from '../../utils/imageCompression';
import { ProductThumb } from './ProductThumb';

interface ProductImageUploaderProps {
  label?: string;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  inheritedUrl?: string | null;
  inheritedThumbnailUrl?: string | null;
  disabled?: boolean;
  onImageUploaded: (img: {
    image_id: number;
    image_url: string;
    thumbnail_url: string;
  }) => void;
  onRemoveImage: () => void;
}

export const ProductImageUploader: React.FC<ProductImageUploaderProps> = ({
  label = 'Product Picture',
  imageUrl,
  thumbnailUrl,
  inheritedUrl,
  inheritedThumbnailUrl,
  disabled = false,
  onImageUploaded,
  onRemoveImage,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCamInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [webcamReady, setWebcamReady] = useState(false);

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setWebcamReady(false);
    setWebcamOpen(false);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const compressed = await compressImageFileForUpload(file);
      const res = await api.uploadProductImage({
        dataUrl: compressed.dataUrl,
        thumbnailDataUrl: compressed.thumbnailDataUrl,
        mimeType: compressed.mimeType,
        fileName: compressed.fileName,
      });
      if (res?.image) {
        onImageUploaded({
          image_id: res.image.id,
          image_url: res.image.image_url,
          thumbnail_url: res.image.thumbnail_url,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload picture.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (mobileCamInputRef.current) mobileCamInputRef.current.value = '';
    }
  };

  const handleOpenWebcam = async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // Fallback to file/mobile camera input
      mobileCamInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setWebcamOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
          setWebcamReady(true);
        }
      }, 60);
    } catch {
      setError('Camera unavailable or permission denied. You can upload a picture from disk instead.');
    }
  };

  const handleCaptureWebcam = async () => {
    if (!videoRef.current) return;
    setUploading(true);
    setError(null);
    try {
      const compressed = await compressCanvasVideoFrame(videoRef.current);
      stopWebcam();
      const res = await api.uploadProductImage({
        dataUrl: compressed.dataUrl,
        thumbnailDataUrl: compressed.thumbnailDataUrl,
        mimeType: compressed.mimeType,
        fileName: compressed.fileName,
      });
      if (res?.image) {
        onImageUploaded({
          image_id: res.image.id,
          image_url: res.image.image_url,
          thumbnail_url: res.image.thumbnail_url,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to capture picture.');
    } finally {
      setUploading(false);
    }
  };

  const hasOwnImage = Boolean(imageUrl);
  const displayThumb = thumbnailUrl || imageUrl || inheritedThumbnailUrl || inheritedUrl || null;
  const displayFull = imageUrl || inheritedUrl || null;

  return (
    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <ImagePlus className="w-3.5 h-3.5 text-emerald-600" />
          <span>{label}</span>
        </span>
        {hasOwnImage ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
            {inheritedUrl ? 'Custom Variant Picture' : 'Uploaded Picture'}
          </span>
        ) : inheritedUrl ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200">
            Inherited from Main Product
          </span>
        ) : (
          <span className="text-[10px] text-slate-400">JPG, PNG, WebP supported</span>
        )}
      </div>

      <div className="flex items-center gap-3.5">
        <ProductThumb
          src={displayThumb}
          fullSrc={displayFull}
          alt={label}
          size="lg"
          enableZoom={Boolean(displayFull)}
          className="bg-white border-slate-300 shadow-2xs"
        />

        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
            />
            <input
              ref={mobileCamInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
            />

            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-emerald-500 hover:text-emerald-700 text-slate-700 text-[11px] font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              {uploading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
              ) : (
                <Upload className="w-3.5 h-3.5 text-emerald-600" />
              )}
              <span>{hasOwnImage ? 'Replace File' : 'Upload Picture'}</span>
            </button>

            <button
              type="button"
              disabled={disabled || uploading}
              onClick={handleOpenWebcam}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-sky-500 hover:text-sky-700 text-slate-700 text-[11px] font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
              title="Capture photo using camera"
            >
              <Camera className="w-3.5 h-3.5 text-sky-600" />
              <span>Camera</span>
            </button>

            {hasOwnImage && (
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={onRemoveImage}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-[11px] font-semibold flex items-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{inheritedUrl ? 'Use Main Picture' : 'Remove'}</span>
              </button>
            )}
          </div>

          <p className="text-[10px] text-slate-500 leading-snug">
            {inheritedUrl && !hasOwnImage
              ? 'Showing Main Product picture automatically. Upload a picture here only if this variant looks different.'
              : 'Click thumbnail to preview full size. Saved directly in database & synced across terminals.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
          {error}
        </div>
      )}

      {webcamOpen && (
        <div className="fixed inset-0 z-[90] bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <span className="text-xs font-bold flex items-center gap-2">
                <Video className="w-4 h-4 text-emerald-400" />
                <span>Capture Product Picture</span>
              </span>
              <button
                type="button"
                onClick={stopWebcam}
                className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="aspect-video bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={stopWebcam}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!webcamReady || uploading}
                  onClick={handleCaptureWebcam}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{uploading ? 'Saving...' : 'Capture Photo'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
