import { BrowserRouter, Routes, Route, Navigate, Outlet, Link, useOutletContext } from "react-router-dom";
import { useState } from "react";

import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";

import Landing         from "./pages/Landing";
import Dashboard       from "./pages/Dashboard";
import Game            from "./pages/Game";
import SentenceGame    from "./pages/SentenceGame";
import Placement       from "./pages/placement/Placement";
import Speaking        from "./pages/speaking/Speaking";
import ProtectedLayout from "./components/organisms/ProtectedLayout";
import AppNavbar       from "./components/organisms/AppNavbar";

function RootLayout() {
  const [showAuth, setShowAuth] = useState(false);
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <AppNavbar onSignIn={() => setShowAuth(true)} />
      <div className="flex-1 flex flex-col pt-[60px]">
        <Outlet context={{ showAuth, setShowAuth }} />
      </div>
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-base)] text-sm text-[var(--text-tertiary)]">
        <div className="max-w-[1200px] mx-auto px-10 py-7 flex justify-between items-center flex-wrap gap-2">
          <Link
            to={user ? "/dashboard" : "/"}
            className="flex items-center gap-[10px] font-bold text-[var(--text-primary)] text-base no-underline"
          >
            <img src="/turtle.png" alt="logo" className="w-7 h-7" />
            TurtleTalks
          </Link>
          <span>© 2026 · Built with ❤️ and a lot of vocabulary</span>
        </div>
      </footer>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
      <div className="w-10 h-10 border-[3px] border-[var(--border-medium)] border-t-[var(--c-orange)] rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return user ? <>{children}</> : <Navigate to="/" replace />;
}

// Public home page. Once a user is logged in, the dashboard is their home,
// so "/" sends them there. While the sign-in modal is still open we let the
// form finish its success animation; it navigates to /dashboard itself.
function HomeRoute() {
  const { user, loading } = useAuth();
  const { showAuth } = useOutletContext<{ showAuth: boolean }>();

  if (loading) return <LoadingScreen />;
  if (user && !showAuth) return <Navigate to="/dashboard" replace />;

  return <Landing />;
}

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<RootLayout />}>
            <Route path="/" element={<HomeRoute />} />

            <Route element={<ProtectedRoute><ProtectedLayout /></ProtectedRoute>}>
              <Route path="/dashboard"            element={<Dashboard />} />
              <Route path="/game"                 element={<Game />} />
              <Route path="/sentence-builder"     element={<SentenceGame />} />
              <Route path="/speaking"             element={<Speaking />} />
              <Route path="/onboarding/placement" element={<Placement />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  );
}
