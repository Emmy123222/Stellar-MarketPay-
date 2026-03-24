/**
 * components/EditProfileForm.tsx
 * Form to view and edit user profile details.
 */
import { useState, useEffect } from "react";
import { fetchProfile, upsertProfile } from "@/lib/api";
import type { UserProfile, UserRole } from "@/utils/types";
import clsx from "clsx";

interface Props {
  publicKey: string;
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

  useEffect(() => {
    fetchProfile(publicKey)
      .then((data) => {
        if (data) {
          setProfile(data);
          setDisplayName(data.displayName || "");
          setBio(data.bio || "");
          setRole(data.role || "freelancer");
          setSkills(data.skills || []);
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
      });
      setProfile(updated);
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
            className="w-full bg-ink-900/50 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 placeholder:text-amber-800/50 focus:outline-none focus:border-market-400 transition-colors"
            placeholder="Jane Doe"
            minLength={3}
            maxLength={30}
          />
          <p className="text-xs text-amber-800 mt-1.5 flex justify-between">
            <span>Minimum 3 characters</span>
            <span>{displayName.length}/30</span>
          </p>
        </div>

        <div>
           <label className="block text-sm font-medium text-amber-100 mb-2">Role</label>
           <div className="flex flex-wrap gap-4">
             {(["freelancer", "client", "both"] as UserRole[]).map((r) => (
               <label key={r} className={clsx(
                 "flex items-center justify-center px-4 py-2.5 rounded-xl border cursor-pointer transition-all",
                 role === r 
                   ? "bg-market-500/10 border-market-400 text-market-300" 
                   : "bg-ink-900/50 border-market-500/20 text-amber-600 hover:border-market-500/50"
               )}>
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
            className="w-full bg-ink-900/50 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 placeholder:text-amber-800/50 focus:outline-none focus:border-market-400 transition-colors h-32 resize-none"
            placeholder="Tell us a little about yourself..."
            maxLength={300}
          />
          <p className="text-xs text-amber-800 mt-1.5 flex justify-between">
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
              className="flex-1 bg-transparent border-none outline-none text-amber-100 placeholder:text-amber-800/50 min-w-[120px] px-2"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-market-500/10 flex justify-end">
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
