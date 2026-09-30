import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditProfileForm } from '../Onboarding/EditProfileForm';

describe('EditProfileForm Avatar Validation (#1406)', () => {
  it('shows an error when uploading an invalid file type', () => {
    render(<EditProfileForm />);
    const fileInput = screen.getByLabelText(/profile avatar/i) as HTMLInputElement;

    const invalidFile = new File(['dummy content'], 'document.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Invalid file type. Only JPEG, PNG, and WebP images are allowed.'
    );
  });

  it('shows an error when uploading a file larger than 5MB', () => {
    render(<EditProfileForm />);
    const fileInput = screen.getByLabelText(/profile avatar/i) as HTMLInputElement;

    // Create a mock file of 6MB
    const largeFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'large.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    expect(screen.getByRole('alert')).toHaveTextContent('File size exceeds the 5MB limit.');
  });

  it('accepts a valid image under 5MB without error', () => {
    const handleSubmit = jest.fn();
    render(<EditProfileForm onSubmit={handleSubmit} />);
    const fileInput = screen.getByLabelText(/profile avatar/i) as HTMLInputElement;

    const validFile = new File(['small content'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(handleSubmit).toHaveBeenCalledWith(validFile);
  });
});