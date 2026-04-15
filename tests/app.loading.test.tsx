import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import App from '../App';
import { analyzePlace } from '../services/apiService';

vi.mock('../services/apiService', () => ({
  analyzePlace: vi.fn(),
}));

describe('App loading state', () => {
  it('shows loading message while analysis request is pending', async () => {
    vi.mocked(analyzePlace).mockImplementation(
      () =>
        new Promise(() => {
          // Keep pending to verify loading UI.
        })
    );

    render(<App />);

    const input = screen.getByLabelText('店舗検索入力');
    fireEvent.change(input, { target: { value: '新宿 居酒屋' } });

    const form = input.closest('form');
    if (!form) {
      throw new Error('form element not found');
    }

    fireEvent.submit(form);

    expect(await screen.findByText('お店の情報を収集中...')).toBeInTheDocument();
  });
});
