// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

const fetchMock = vi.hoisted(() => vi.fn());

const text = {
  loginTitle: '\u767b\u5f55\u8d26\u6237',
  registerTitle: '\u672c\u5730\u6ce8\u518c',
  email: '\u90ae\u7bb1\u5730\u5740',
  password: '\u5bc6\u7801 (\u81f3\u5c118\u4f4d)',
  confirmPassword: '\u786e\u8ba4\u5bc6\u7801',
  inviteCode: '\u9080\u8bf7\u7801',
  registerButton: '\u6ce8\u518c\u5e76\u767b\u5f55',
  loginButton: '\u767b\u5f55',
  switchToRegister: '\u6ca1\u6709\u8d26\u6237? \u672c\u5730\u6ce8\u518c',
  passwordMismatch: '\u4e24\u6b21\u8f93\u5165\u7684\u5bc6\u7801\u4e0d\u4e00\u81f4',
};

expect.extend(matchers);

async function renderAuthPage() {
  const { default: AuthPage } = await import('./AuthPage');
  return render(<AuthPage />);
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => url === '/api/auth/config'
        ? ({ allow_open_registration: true })
        : ({ id: 'user-1', email: 'test@example.com', role: 'user' }),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders login form by default', async () => {
    await renderAuthPage();

    expect(screen.getByRole('heading', { name: text.loginTitle })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(text.email)).toBeInTheDocument();
  });

  it('switches to register form', async () => {
    await renderAuthPage();

    fireEvent.click(screen.getByRole('button', { name: text.switchToRegister }));

    expect(screen.getByRole('heading', { name: text.registerTitle })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(text.confirmPassword)).toBeInTheDocument();
  });

  it('validates password match during registration', async () => {
    await renderAuthPage();
    fireEvent.click(screen.getByRole('button', { name: text.switchToRegister }));

    fireEvent.change(screen.getByPlaceholderText(text.email), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText(text.password), { target: { value: 'password123' } });
    fireEvent.change(screen.getByPlaceholderText(text.confirmPassword), { target: { value: 'password456' } });
    fireEvent.click(screen.getByRole('button', { name: text.registerButton }));

    expect(await screen.findByText(text.passwordMismatch)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/register', expect.anything());
  });

  it('calls register when form is valid', async () => {
    await renderAuthPage();
    fireEvent.click(screen.getByRole('button', { name: text.switchToRegister }));

    fireEvent.change(screen.getByPlaceholderText(text.email), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText(text.password), { target: { value: 'password123' } });
    fireEvent.change(screen.getByPlaceholderText(text.confirmPassword), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: text.registerButton }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'password123', invite_code: null }),
      }));
    });
  });

  it('shows invite code when open registration is disabled', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => url === '/api/auth/config'
        ? ({ allow_open_registration: false })
        : ({ id: 'user-1', email: 'test@example.com', role: 'user' }),
    }));
    await renderAuthPage();
    fireEvent.click(screen.getByRole('button', { name: text.switchToRegister }));

    expect(await screen.findByPlaceholderText(text.inviteCode)).toBeInTheDocument();
  });

  it('calls login when login form is submitted', async () => {
    await renderAuthPage();

    fireEvent.change(screen.getByPlaceholderText(text.email), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText(text.password), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: text.loginButton }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
      }));
    });
  });
});
