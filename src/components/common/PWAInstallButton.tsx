import React, { useState } from 'react';
import { Download, Monitor, ExternalLink, CheckCircle2, X, Smartphone, HelpCircle } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'login';
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header',
  compact = false,
}) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  // If already running as a standalone installed POS desktop/mobile app, show a subtle badge or hide
  if (isInstalled) {
    if (variant === 'sidebar') {
      return (
        <div className="px-2.5 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-between text-[10px] text-emerald-300">
          <span className="flex items-center gap-1.5 font-semibold">
            <Monitor className="w-3.5 h-3.5 text-emerald-400" />
            <span>POS App Mode Active</span>
          </span>
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[9px] font-bold">
            INSTALLED
          </span>
        </div>
      );
    }
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setShowGuideModal(true);
  };

  const currentAppUrl = typeof window !== 'undefined' ? window.location.origin : '/';

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          type="button"
          onClick={handleInstallClick}
          className="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-between shadow-sm transition-all cursor-pointer border border-emerald-400/30"
          title="Install Abrar Medical Store POS in Google Chrome as a Standalone Desktop Application"
        >
          <span className="flex items-center gap-2 truncate">
            <Monitor className="w-4 h-4 shrink-0" />
            <span className="truncate">Install Chrome POS App</span>
          </span>
          <span className="px-1.5 py-0.5 rounded bg-black/25 text-[9px] font-mono uppercase shrink-0">
            {isInstallable ? '1-Click' : 'Install'}
          </span>
        </button>
      ) : variant === 'login' ? (
        <button
          type="button"
          onClick={handleInstallClick}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-950/50 border border-emerald-400/30 transition-all cursor-pointer"
          title="Install Abrar Medical Store POS as a standalone Chrome Desktop Application"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install POS App</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleInstallClick}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition-all shadow-2xs cursor-pointer shrink-0"
          title="Install Abrar Medical Store POS on Desktop / Chrome"
        >
          <Download className="w-3 h-3" />
          <span>{compact ? 'Install POS' : 'Install POS App'}</span>
        </button>
      )}

      {/* Guided Installation & Standalone Chrome POS Setup Modal */}
      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 print:hidden"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full max-w-lg bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-teal-900 px-5 py-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0">
                  <Monitor className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">
                    Install Abrar Medical Store — Chrome POS Application
                  </h3>
                  <p className="text-[11px] text-emerald-200/90">
                    Run as a dedicated fullscreen/standalone POS window on Desktop &amp; Taskbar
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-xs">
              {/* Direct Native Prompt Button if available */}
              {isInstallable && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Ready for 1-Click Chrome POS Installation</span>
                    </div>
                    <p className="text-[11px] text-emerald-800">
                      Click the button on the right to launch Chrome&apos;s native POS app installer.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await install();
                      if (ok) setShowGuideModal(false);
                    }}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Install Now</span>
                  </button>
                </div>
              )}

              {/* Notice when inside preview iframe */}
              {isInIframe && !isInstallable && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                  <div className="font-bold text-amber-950 flex items-center gap-1.5">
                    <ExternalLink className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Step 1: Open in a Dedicated Google Chrome Tab First</span>
                  </div>
                  <p className="text-[11px] text-amber-900 leading-relaxed">
                    Google Chrome requires web apps to be opened in their own browser tab (outside the preview frame) before showing the <strong>Install App</strong> prompt.
                  </p>
                  <a
                    href={currentAppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open POS in New Chrome Tab to Install</span>
                  </a>
                </div>
              )}

              {/* Step-by-Step Chrome Desktop POS Instructions */}
              {!isIOS ? (
                <div className="space-y-2.5">
                  <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5 text-emerald-600" />
                    <span>How to Install in Google Chrome (Desktop POS Window):</span>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <div>
                        <div className="font-bold text-slate-900">
                          Option A — Address Bar Install Icon (Fastest)
                        </div>
                        <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                          Look at the right side of the Google Chrome address bar (URL bar) and click the{' '}
                          <strong className="text-slate-900">Install Abrar Medical Store (AMS)</strong> icon{' '}
                          <span className="inline-block px-1.5 py-0.2 rounded bg-slate-200 font-mono text-[10px]">
                            ⊕ / ⬇
                          </span>
                          , then click <strong>Install</strong>.
                        </p>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <div>
                        <div className="font-bold text-slate-900">
                          Option B — From Chrome Menu (⋮)
                        </div>
                        <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                          Click the 3-dots menu <strong>(⋮)</strong> in the top-right corner of Chrome &rarr;{' '}
                          <strong>Cast, save, and share</strong> &rarr;{' '}
                          <strong>Install page as app...</strong> (or <strong>Create shortcut...</strong> and check{' '}
                          <em>&ldquo;Open as window&rdquo;</em>).
                        </p>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200/80 flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-teal-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                        ✓
                      </span>
                      <div>
                        <div className="font-bold text-emerald-950">
                          Launches Like Native POS Software
                        </div>
                        <p className="text-emerald-800 text-[11px] mt-0.5 leading-relaxed">
                          Once installed, <strong>Abrar Medical Store POS</strong> opens in its own dedicated window without browser tabs or URL bars, pins to your Windows Taskbar / Desktop, and supports barcode scanners &amp; thermal/A4 printing.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-emerald-600" />
                    <span>Install on iPhone / iPad (Safari):</span>
                  </div>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    1. Tap the <strong>Share</strong> button in the Safari toolbar.<br />
                    2. Scroll down and tap <strong>Add to Home Screen</strong>.<br />
                    3. Tap <strong>Add</strong> to launch Abrar Medical Store in full-screen standalone mode.
                  </p>
                </div>
              )}

              {/* Footer Actions */}
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                  <span>Works on Windows, macOS, Linux &amp; Android Chrome</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuideModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
