import React, { useState } from 'react';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function EditProfileForm({ onSubmit }: { onSubmit?: (file: File) => void }) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = e.target.files;
    
    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > MAX_FILE_SIZE) {
      setError('File size exceeds the 5MB limit.');
      return;
    }

    setAvatarFile(file);
    // jsdom does not implement createObjectURL; skip the preview rather than
    // throwing before onSubmit runs.
    if (typeof URL.createObjectURL === "function") {
      setPreview(URL.createObjectURL(file));
    }

    if (onSubmit) {
      onSubmit(file);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-xl shadow-md mt-10">
      <h2 className="text-xl font-bold text-gray-800 mb-4">Edit Profile</h2>

      <div className="mb-4">
        <label htmlFor="profile-avatar" className="block text-sm font-medium text-gray-700 mb-2">Profile Avatar</label>
        <input
          id="profile-avatar"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />

        {error && (
          <p className="text-sm text-red-600 mt-2" role="alert">
            {error}
          </p>
        )}

        {preview && !error && (
          <div className="mt-4">
            <img src={preview} alt="Avatar preview" className="w-20 h-20 rounded-full object-cover border" />
          </div>
        )}
      </div>
    </div>
  );
}