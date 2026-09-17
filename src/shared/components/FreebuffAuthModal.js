"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

/**
 * Freebuff Auth Modal
 * Auto-detect and import token from Freebuff/Codebuff's local credentials.json
 */
export default function FreebuffAuthModal({ isOpen, onSuccess, onClose }) {
  const [authToken, setAuthToken] = useState("");
  const [fingerprintId, setFingerprintId] = useState("");
  const [fingerprintHash, setFingerprintHash] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [detectedPath, setDetectedPath] = useState("");

  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  const runAutoDetect = async () => {
    setAutoDetecting(true);
    setError(null);
    setAutoDetected(false);

    try {
      const res = await fetch("/api/oauth/freebuff/auto-import");
      const data = await res.json();

      if (data.found && data.authToken) {
        setAuthToken(data.authToken);
        setFingerprintId(data.fingerprintId || "");
        setFingerprintHash(data.fingerprintHash || "");
        setName(data.name || "");
        setEmail(data.email || "");
        setDetectedPath(data.path || "");
        setAutoDetected(true);
      } else {
        // Not auto-detected, show error/guidance
        if (data.error) {
          setError(data.error);
        }
      }
    } catch {
      setError("Failed to auto-detect Freebuff credentials");
    } finally {
      setAutoDetecting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    runAutoDetect();
  }, [isOpen]);

  const handleImportToken = async () => {
    if (!authToken.trim()) {
      setError("Please enter a Freebuff auth token");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/freebuff/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authToken: authToken.trim(),
          fingerprintId: fingerprintId.trim() || undefined,
          fingerprintHash: fingerprintHash.trim() || undefined,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Freebuff (Codebuff)" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Auto-detecting loading */}
        {autoDetecting && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Auto-detecting Freebuff...</h3>
            <p className="text-sm text-text-muted">
              Scanning local ~/.config/manicode/credentials.json
            </p>
          </div>
        )}

        {/* Form */}
        {!autoDetecting && (
          <>
            {autoDetected ? (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800 flex flex-col gap-1">
                <div className="flex gap-2 items-center">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Freebuff credentials auto-detected!
                  </p>
                </div>
                {detectedPath && (
                  <p className="text-xs text-green-700 dark:text-green-300 font-mono truncate">
                    {detectedPath}
                  </p>
                )}
                {email && (
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Account: <strong>{name || email}</strong> ({email})
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800 flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Paste your <code>authToken</code> from <code>~/.config/manicode/credentials.json</code>, or run Freebuff CLI once to auto-detect.
                  </p>
                </div>
                <Button onClick={runAutoDetect} variant="outline" size="sm">
                  Retry Auto-Detect
                </Button>
              </div>
            )}

            {/* Auth Token Input */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Auth Token <span className="text-red-500">*</span>
              </label>
              <textarea
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Paste authToken here..."
                rows={3}
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Optional Email & Name */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1 text-text-muted">Account Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Optional display name"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-text-muted">Email</label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Optional email"
                  className="text-sm"
                />
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-2">
              <Button
                onClick={handleImportToken}
                fullWidth
                disabled={importing || !authToken.trim()}
              >
                {importing ? "Connecting..." : "Connect Freebuff"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

FreebuffAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
