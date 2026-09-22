import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { api } from '@/lib/api';
import { Mail, Lock, Ticket, AlertCircle, Eye, EyeOff, CheckCircle, Loader2 } from 'lucide-react';

const text = {
  loginTitle: '\u767b\u5f55\u8d26\u6237',
  registerTitle: '\u672c\u5730\u6ce8\u518c',
  loginSubtitle: '\u6b22\u8fce\u56de\u6765\uff0c\u8bf7\u767b\u5f55\u4ee5\u7ba1\u7406\u60a8\u7684\u8d44\u4ea7',
  registerSubtitle: '\u521b\u5efa\u4f60\u81ea\u5df1\u7684\u8d26\u6237\uff0c\u8d44\u4ea7\u6570\u636e\u4ec5\u4fdd\u5b58\u5728\u5f53\u524d\u5b9e\u4f8b',
  email: '\u90ae\u7bb1\u5730\u5740',
  password: '\u5bc6\u7801 (\u81f3\u5c118\u4f4d)',
  confirmPassword: '\u786e\u8ba4\u5bc6\u7801',
  inviteCode: '\u9080\u8bf7\u7801',
  passwordMismatch: '\u4e24\u6b21\u8f93\u5165\u7684\u5bc6\u7801\u4e0d\u4e00\u81f4',
  passwordTooShort: '\u5bc6\u7801\u957f\u5ea6\u81f3\u5c11\u9700\u89818\u4f4d',
  inviteRequired: '\u8bf7\u8f93\u5165\u9080\u8bf7\u7801',
  registerSuccess: '\u6ce8\u518c\u6210\u529f\uff0c\u5df2\u4e3a\u60a8\u767b\u5f55\u3002',
  unknownError: '\u53d1\u751f\u672a\u77e5\u9519\u8bef',
  resetHint: '\u5f53\u524d\u7248\u672c\u6682\u4e0d\u63d0\u4f9b\u90ae\u4ef6\u627e\u56de\u5bc6\u7801\uff0c\u8bf7\u59a5\u5584\u4fdd\u7ba1\u672c\u5730\u8d26\u53f7\u3002',
  loginButton: '\u767b\u5f55',
  registerButton: '\u6ce8\u518c\u5e76\u767b\u5f55',
  showPassword: '\u663e\u793a\u5bc6\u7801',
  hidePassword: '\u9690\u85cf\u5bc6\u7801',
  switchToRegister: '\u6ca1\u6709\u8d26\u6237? \u672c\u5730\u6ce8\u518c',
  switchToLogin: '\u5df2\u6709\u8d26\u6237? \u7acb\u5373\u767b\u5f55',
};

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [openRegistration, setOpenRegistration] = useState(true);
  const { login, register } = useAuthStore();

  useEffect(() => {
    api.authConfig()
      .then((config) => setOpenRegistration(config.allow_open_registration))
      .catch(() => setOpenRegistration(true));
  }, []);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!isLogin) {
      if (password !== confirmPassword) {
        setError(text.passwordMismatch);
        return;
      }
      if (password.length < 8) {
        setError(text.passwordTooShort);
        return;
      }
      if (!openRegistration && !inviteCode.trim()) {
        setError(text.inviteRequired);
        return;
      }
    }

    setLoading(true);
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, inviteCode.trim());
        setSuccessMessage(text.registerSuccess);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : text.unknownError);
    } finally {
      setLoading(false);
    }
  };

  const title = isLogin ? text.loginTitle : text.registerTitle;
  const subtitle = isLogin ? text.loginSubtitle : text.registerSubtitle;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8 bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900 dark:text-white">{title}</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleAuth}>
          <div className="rounded-md shadow-sm space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <input
                type="email"
                required
                className="appearance-none relative block w-full px-3 py-2 pl-10 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-700 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder={text.email}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                className="appearance-none relative block w-full px-3 py-2 pl-10 pr-10 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-700 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder={text.password}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                aria-label={showPassword ? text.hidePassword : text.showPassword}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            {!isLogin && (
              <>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="appearance-none relative block w-full px-3 py-2 pl-10 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-700 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                    placeholder={text.confirmPassword}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
                {!openRegistration && <div className="relative">
                  <Ticket className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                  <input
                    required
                    className="appearance-none relative block w-full px-3 py-2 pl-10 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-white dark:bg-gray-700 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                    placeholder={text.inviteCode}
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                  />
                </div>}
              </>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/30 p-4">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-200">{error}</h3>
                </div>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="rounded-md bg-green-50 dark:bg-green-900/30 p-4">
              <div className="flex">
                <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800 dark:text-green-200">{successMessage}</h3>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400">{text.resetHint}</p>

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />}
            {isLogin ? text.loginButton : text.registerButton}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin((value) => !value)}
            className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            {isLogin ? text.switchToRegister : text.switchToLogin}
          </button>
        </div>
      </div>
    </div>
  );
}
