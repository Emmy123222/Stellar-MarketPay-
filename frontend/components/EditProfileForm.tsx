/**
 * components/EditProfileForm.tsx
 * Form to view and edit user profile details.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { fetchProfile, updateProfileAvailability, upsertProfile, uploadPortfolioFiles } from "@/lib/api";
import type {
  Availability,
  AvailabilityStatus,
  PortfolioItem,
  PortfolioItemType,
  PortfolioFile,
  UserProfile,
  UserRole,
} from "@/utils/types";
import clsx from "clsx";

interface Props {
  publicKey: string;
}

const MAX_PORTFOLIO_ITEMS = 10;
const MAX_PORTFOLIO_FILES = 10;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const portfolioTypeOptions: { value: PortfolioItemType; label: string; placeholder: string }[] = [
  { value: "github", label: "GitHub Repo", placeholder: "https://github.com/username/project" },
  { value: "live", label: "Live URL", placeholder: "https://example.com" },
  { value: "stellar_tx", label: "Stellar Transaction", placeholder: "Transaction ID" },
  { value: "file", label: "Uploaded File", placeholder: "Select file to upload" },
];
const availabilityStatusOptions: { value: AvailabilityStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "busy", label: "Busy" },
  { value: "unavailable", label: "Unavailable" },
];

function createEmptyPortfolioItem(): PortfolioItem {
  return { title: "", url: "", type: "github" };
}

function createDefaultAvailability(): Availability {
  return {
    status: "available",
    availableFrom: "",
    availableUntil: "",
  };
}

export default function EditProfileForm({ publicKey }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [role, setRole] = useState<UserRole>("freelancer");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [portfolioFiles, setPortfolioFiles] = useState<PortfolioFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<number, number>>({});
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [availability, setAvailability] = useState<Availability>(createDefaultAvailability());

  useEffect(() => {
    fetchProfile(publicKey)
      .then((data) => {
        if (data) {
          setProfile(data);
          setDisplayName(data.displayName || "");
          setBio(data.bio || "");
          setRole(data.role || "freelancer");
          setSkills(data.skills || []);
          setPortfolioItems(data.portfolioItems || []);
          setPortfolioFiles(data.portfolioFiles || []);
          setAvailability({
            status: data.availability?.status || "available",
            availableFrom: data.availability?.availableFrom || "",
            availableUntil: data.availability?.availableUntil || "",
          });
        }
      })
      .catch((err) => {
        console.error("Failed to load profile:", err);
      })
      .finally(() => setLoading(false));
  }, [publicKey]);

  const handleAddSkill = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = skillInput.trim();
      if (val && !skills.includes(val)) {
        setSkills([...skills, val]);
      }
      setSkillInput("");
    }
  };

  const removeSkill = (skillToRemove: string) => {
    setSkills(skills.filter((s) => s !== skillToRemove));
  };

  const addPortfolioItem = () => {
    if (portfolioItems.length >= MAX_PORTFOLIO_ITEMS) {
      setErrorMsg(`You can add up to ${MAX_PORTFOLIO_ITEMS} portfolio items.`);
      return;
    }
    setErrorMsg("");
    setPortfolioItems((current) => [...current, createEmptyPortfolioItem()]);
  };

  const updatePortfolioItem = <K extends keyof PortfolioItem>(
    index: number,
    key: K,
    value: PortfolioItem[K]
  ) => {
    setPortfolioItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item
      )
    );
  };

  const removePortfolioItem = (index: number) => {
    setPortfolioItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const updateAvailabilityField = <K extends keyof Availability>(key: K, value: Availability[K]) => {
    setAvailability((current) => ({ ...current, [key]: value }));
  };

  const validateFiles = useCallback((files: FileList | File[]): { valid: File[]; errors: string[] } => {
    const valid: File[] = [];
    const errors: string[] = [];
    const filesArr = Array.from(files);

    if (portfolioFiles.length + filesArr.length > MAX_PORTFOLIO_FILES) {
      errors.push(`Maximum ${MAX_PORTFOLIO_FILES} files allowed. You have ${portfolioFiles.length} and tried to add ${filesArr.length}.`);
      return { valid, errors };
    }

    for (const file of filesArr) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push(`"${file.name}" exceeds 5MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      } else {
        valid.push(file);
      }
    }
    return { valid, errors };
  }, [portfolioFiles.length]);

  const handleFileUpload = async (files: FileList | File[]) => {
    const { valid, errors } = validateFiles(files);
    if (errors.length > 0) {
      setErrorMsg(errors.join(". "));
      return;
    }
    if (valid.length === 0) return;

    setUploadingFiles(true);
    setErrorMsg("");
    const initialProgress: Record<number, number> = {};
    valid.forEach((_, i) => { initialProgress[i] = 0; });
    setUploadProgress(initialProgress);

    try {
      const result = await uploadPortfolioFiles(publicKey, valid, (fileIndex, percent) => {
        setUploadProgress((prev) => ({ ...prev, [fileIndex]: percent }));
      });
      setPortfolioFiles((current) => [...current, ...result.uploadedFiles]);
      setSuccessMsg(`${result.uploadedFiles.length} file(s) uploaded successfully!`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      console.error("File upload error:", err);
      setErrorMsg(err.response?.data?.error || "Failed to upload files");
    } finally {
      setUploadingFiles(false);
      setUploadProgress({});
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  }, [handleFileUpload]);

  const removePortfolioFile = (index: number) => {
    setPortfolioFiles((current) => current.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (displayName && (displayName.length < 3 || displayName.length > 30)) {
      setErrorMsg("Display Name must be between 3 and 30 characters.");
      return;
    }
    if (bio && bio.length > 300) {
      setErrorMsg("Bio cannot exceed 300 characters.");
      return;
    }
    if (portfolioItems.length > MAX_PORTFOLIO_ITEMS) {
      setErrorMsg(`You can add up to ${MAX_PORTFOLIO_ITEMS} portfolio items.`);
      return;
    }

    const normalizedPortfolioItems = portfolioItems.map((item) => ({
      title: item.title.trim(),
      url: item.url.trim(),
      type: item.type,
    }));

    const hasIncompletePortfolioItem = normalizedPortfolioItems.some(
      (item) => !item.title || !item.url || !item.type
    );

    if (hasIncompletePortfolioItem) {
      setErrorMsg("Each portfolio item needs a title, type, and URL or transaction ID.");
      return;
    }

    if (
      availability.availableFrom &&
      availability.availableUntil &&
      new Date(availability.availableFrom) > new Date(availability.availableUntil)
    ) {
      setErrorMsg("Available from must be before available until.");
      return;
    }

    setSaving(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const updated = await upsertProfile({
        publicKey,
        displayName,
        bio,
        role,
        skills,
        portfolioItems: normalizedPortfolioItems,
        portfolioFiles,
      });

      const availabilityPayload: Availability = {
        status: availability.status,
        ...(availability.availableFrom ? { availableFrom: availability.availableFrom } : {}),
        ...(availability.availableUntil ? { availableUntil: availability.availableUntil } : {}),
      };
      const profileWithAvailability = await updateProfileAvailability(publicKey, availabilityPayload);

      setProfile(profileWithAvailability);
      setPortfolioItems(profileWithAvailability.portfolioItems || []);
      setAvailability({
        status: profileWithAvailability.availability?.status || "available",
        availableFrom: profileWithAvailability.availability?.availableFrom || "",
        availableUntil: profileWithAvailability.availability?.availableUntil || "",
      });
      setSuccessMsg("Profile saved successfully!");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.error || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card animate-pulse py-16 text-center">
        <div className="w-8 h-8 rounded-full border-2 border-market-400 border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-amber-800 text-sm">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="font-display text-2xl font-semibold text-amber-100 mb-6">Edit Profile</h2>

      {successMsg && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-amber-100 mb-2">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-ink-900/50 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 placeholder:text-amber-600/70 focus:outline-none focus:border-market-400 transition-colors"
            placeholder="Jane Doe"
            minLength={3}
            maxLength={30}
          />
          <p className="text-xs text-amber-600 mt-1.5 flex justify-between">
            <span>Minimum 3 characters</span>
            <span>{displayName.length}/30</span>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-amber-100 mb-2">Role</label>
          <div className="flex flex-wrap gap-4">
            {(["freelancer", "client", "both"] as UserRole[]).map((r) => (
              <label
                key={r}
                className={clsx(
                  "flex items-center justify-center px-4 py-2.5 rounded-xl border cursor-pointer transition-all",
                  role === r
                    ? "bg-market-500/10 border-market-400 text-market-300"
                    : "bg-ink-900/50 border-market-500/20 text-amber-600 hover:border-market-500/50"
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="sr-only"
                />
                <span className="capitalize">{r}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-amber-100 mb-2">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="w-full bg-ink-900/50 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 placeholder:text-amber-600/70 focus:outline-none focus:border-market-400 transition-colors h-32 resize-none"
            placeholder="Tell us a little about yourself..."
            maxLength={300}
          />
          <p className="text-xs text-amber-600 mt-1.5 flex justify-between">
            <span>Brief description of your expertise and background</span>
            <span>{bio.length}/300</span>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-amber-100 mb-2">Skills</label>
          <div className="bg-ink-900/50 border border-market-500/20 rounded-xl p-2 focus-within:border-market-400 transition-colors min-h-[52px] flex flex-wrap gap-2 items-center">
            {skills.map((skill) => (
              <span key={skill} className="flex items-center gap-1.5 bg-ink-800 border border-market-500/20 text-amber-100 text-sm px-2.5 py-1 rounded-lg">
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="text-amber-600 hover:text-red-400 transition-colors"
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              type="text"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={handleAddSkill}
              placeholder={skills.length === 0 ? "Type a skill and press Enter..." : "Add more..."}
              className="flex-1 bg-transparent border-none outline-none text-amber-100 placeholder:text-amber-600/70 min-w-[120px] px-2"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <label className="block text-sm font-medium text-amber-100">Availability</label>
              <p className="text-xs text-amber-600 mt-1">
                Show clients when you can take on new work.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-market-500/20 bg-ink-900/50 p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-amber-100 mb-1.5">Status</label>
              <select
                value={availability.status}
                onChange={(e) => updateAvailabilityField("status", e.target.value as AvailabilityStatus)}
                className="w-full bg-ink-950/60 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 focus:outline-none focus:border-market-400 transition-colors"
              >
                {availabilityStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-amber-100 mb-1.5">Available From</label>
                <input
                  type="date"
                  value={availability.availableFrom ? availability.availableFrom.slice(0, 10) : ""}
                  onChange={(e) => updateAvailabilityField("availableFrom", e.target.value)}
                  className="w-full bg-ink-950/60 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 focus:outline-none focus:border-market-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-amber-100 mb-1.5">Available Until</label>
                <input
                  type="date"
                  value={availability.availableUntil ? availability.availableUntil.slice(0, 10) : ""}
                  onChange={(e) => updateAvailabilityField("availableUntil", e.target.value)}
                  className="w-full bg-ink-950/60 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 focus:outline-none focus:border-market-400 transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <label className="block text-sm font-medium text-amber-100">Portfolio</label>
              <p className="text-xs text-amber-600 mt-1">
                Add up to {MAX_PORTFOLIO_ITEMS} verified work samples.
              </p>
            </div>
            <button
              type="button"
              onClick={addPortfolioItem}
              disabled={portfolioItems.length >= MAX_PORTFOLIO_ITEMS}
              className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Item
            </button>
          </div>

          <div className="space-y-3">
            {portfolioItems.map((item, index) => {
              const selectedType = portfolioTypeOptions.find((option) => option.value === item.type) || portfolioTypeOptions[0];

              return (
                <div
                  key={`${item.type}-${index}`}
                  className="rounded-xl border border-market-500/20 bg-ink-900/50 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-amber-100">Sample {index + 1}</p>
                    <button
                      type="button"
                      onClick={() => removePortfolioItem(index)}
                      className="text-sm text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-amber-100 mb-1.5">Title</label>
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) => updatePortfolioItem(index, "title", e.target.value)}
                        className="w-full bg-ink-950/60 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 placeholder:text-amber-600/70 focus:outline-none focus:border-market-400 transition-colors"
                        placeholder="Escrow payment flow"
                        maxLength={80}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-amber-100 mb-1.5">Type</label>
                      <select
                        value={item.type}
                        onChange={(e) => updatePortfolioItem(index, "type", e.target.value as PortfolioItemType)}
                        className="w-full bg-ink-950/60 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 focus:outline-none focus:border-market-400 transition-colors"
                      >
                        {portfolioTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-amber-100 mb-1.5">
                      {item.type === "stellar_tx" ? "Transaction ID" : "URL"}
                    </label>
                    <input
                      type="text"
                      value={item.url}
                      onChange={(e) => updatePortfolioItem(index, "url", e.target.value)}
                      className="w-full bg-ink-950/60 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 placeholder:text-amber-600/70 focus:outline-none focus:border-market-400 transition-colors"
                      placeholder={selectedType.placeholder}
                    />
                  </div>
                </div>
              );
            })}

            {portfolioItems.length === 0 && (
              <div className="rounded-xl border border-dashed border-market-500/20 bg-ink-900/30 px-4 py-6 text-sm text-amber-800">
                No portfolio items yet. Add GitHub repos, live URLs, or Stellar transaction proofs.
              </div>
            )}

            {/* File Upload Section */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <label className="block text-sm font-medium text-amber-100">Upload Files</label>
                  <p className="text-xs text-amber-600 mt-1">
                    Upload up to {MAX_PORTFOLIO_FILES} files (max 5MB each). Images and PDFs supported.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {/* Drag-and-Drop Zone */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={clsx(
                    "rounded-xl border-2 border-dashed px-4 py-8 text-center transition-all cursor-pointer",
                    isDragOver
                      ? "border-market-400 bg-market-500/10 scale-[1.01]"
                      : "border-market-500/30 bg-ink-900/40 hover:border-market-500/50",
                    (uploadingFiles || portfolioFiles.length >= MAX_PORTFOLIO_FILES) && "opacity-50 cursor-not-allowed"
                  )}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload portfolio files. Click or drag and drop files here."
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFileUpload(e.target.files);
                        e.target.value = "";
                      }
                    }}
                    disabled={uploadingFiles || portfolioFiles.length >= MAX_PORTFOLIO_FILES}
                    className="hidden"
                    aria-hidden="true"
                  />
                  <div className={clsx("text-3xl mb-2 transition-colors", isDragOver ? "text-market-400" : "text-amber-600")}>
                    {isDragOver ? "\u2191" : "\u2193"}
                  </div>
                  <p className="text-sm text-amber-100 font-medium">
                    {uploadingFiles ? "Uploading..." : isDragOver ? "Drop files here" : "Click or drag and drop files"}
                  </p>
                  <p className="text-xs text-amber-600 mt-1">
                    {portfolioFiles.length}/{MAX_PORTFOLIO_FILES} files uploaded
                  </p>
                </div>

                {/* Per-file upload progress */}
                {Object.keys(uploadProgress).length > 0 && (
                  <div className="space-y-2">
                    {Object.entries(uploadProgress).map(([idx, pct]) => (
                      <div key={idx} className="rounded-lg border border-market-500/20 bg-ink-900/50 p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-amber-100">Uploading file {Number(idx) + 1}...</span>
                          <span className="text-xs text-market-400 font-mono">{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-ink-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-market-400 rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Uploaded Files List with thumbnails */}
                {portfolioFiles.length > 0 && (
                  <div className="space-y-2">
                    {portfolioFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-3 rounded-lg border border-market-500/20 bg-ink-900/50"
                      >
                        {file.mimeType.startsWith("image/") && file.url ? (
                          <img
                            src={file.url}
                            alt={file.fileName}
                            className="w-10 h-10 rounded-lg object-cover border border-market-500/20 flex-shrink-0"
                          />
                        ) : (
                          <span className="w-10 h-10 rounded-lg bg-ink-800 border border-market-500/20 flex items-center justify-center text-lg flex-shrink-0">
                            {file.mimeType === "application/pdf" ? "\uD83D\uDCC4" : "\uD83D\uDCCE"}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-amber-100 font-medium truncate">{file.fileName}</p>
                          <p className="text-xs text-amber-600">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePortfolioFile(index)}
                          className="text-sm text-red-400 hover:text-red-300 transition-colors flex-shrink-0"
                          aria-label={`Remove ${file.fileName}`}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-market-500/10 flex justify-between items-center gap-3">
          <p className="text-xs text-amber-600">
            {portfolioItems.length}/{MAX_PORTFOLIO_ITEMS} portfolio items
          </p>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
