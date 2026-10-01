import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingFlow } from '../Onboarding/OnboardingFlow';

describe('OnboardingFlow Checkpoint (#1415)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('persists step and form data in sessionStorage and restores on mount', () => {
    // Preload session storage
    const savedState = {
      step: 2,
      formData: { fullName: 'Bob Builder', skills: 'Smart Contracts', payoutAddress: '' },
    };
    sessionStorage.setItem('stellar_marketpay_onboarding_checkpoint', JSON.stringify(savedState));

    render(<OnboardingFlow onComplete={() => {}} />);

    // Should resume at step 2 with prefilled data
    expect(screen.getByText('Freelancer Onboarding (Step 2 of 3)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Smart Contracts')).toBeInTheDocument();
  });

  it('clears sessionStorage upon successful completion', () => {
    const handleComplete = jest.fn();
    const { rerender } = render(<OnboardingFlow onComplete={handleComplete} />);

    // Progress to step 3 and complete
    fireEvent.change(screen.getByPlaceholderText('Alice Developer'), { target: { value: 'Charlie' } });
    fireEvent.click(screen.getByText('Next')); // to step 2
    fireEvent.change(screen.getByPlaceholderText('Rust, React, Stellar'), { target: { value: 'Solidity' } });
    fireEvent.click(screen.getByText('Next')); // to step 3
    fireEvent.change(screen.getByPlaceholderText('G...'), { target: { value: 'G12345' } });
    fireEvent.click(screen.getByText('Complete'));

    expect(handleComplete).toHaveBeenCalled();
    expect(sessionStorage.getItem('stellar_marketpay_onboarding_checkpoint')).toBeNull();
  });

  it('triggers onResumeLater when "Resume later" button is clicked', () => {
    const handleResumeLater = jest.fn();
    render(<OnboardingFlow onComplete={() => {}} onResumeLater={handleResumeLater} />);

    fireEvent.click(screen.getByText('Resume later'));
    expect(handleResumeLater).toHaveBeenCalled();
  });
});