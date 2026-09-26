import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const ThrowError = () => {
  throw new Error("Test error");
  return null;
};

describe('ErrorBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    // Suppress console.error in tests to keep output clean
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders fallback without crashing when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    // Assert that the friendly fallback UI is visible
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('An unexpected error occurred while rendering this page.')).toBeInTheDocument();
    
    // Assert that console.error was called with the error
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
