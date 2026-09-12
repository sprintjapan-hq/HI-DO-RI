import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from 'sonner';

import CreatePoll from '@/pages/create-poll';
import PollView from '@/pages/poll-view';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import MyPage from '@/pages/my-page';
import EditPoll from '@/pages/edit-poll';
import FeatureRequest from '@/pages/feature-request';
import FeatureHistory from '@/pages/feature-history';
import Privacy from '@/pages/privacy';
import AdminDevelopment from '@/pages/admin-development';
import ClaimLegacyPoll from '@/pages/claim-legacy-poll';
import { ThemeProvider } from '@/lib/theme';
import { ClerkProvider, Show, SignIn, SignUp } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Redirect, useLocation } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#f97316",
    colorForeground: "#e5e7eb",
    colorMutedForeground: "#9ca3af",
    colorDanger: "#f87171",
    colorBackground: "#111827",
    colorInput: "#0f172a",
    colorInputForeground: "#e5e7eb",
    colorNeutral: "#374151",
    fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#111827] rounded-xl w-[440px] max-w-full overflow-hidden border border-[#263244]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#f3f4f6]",
    headerSubtitle: "text-[#a7b0bf]",
    socialButtonsBlockButtonText: "text-[#e5e7eb]",
    formFieldLabel: "text-[#e5e7eb]",
    footerActionLink: "text-[#fb923c] hover:text-[#fdba74]",
    footerActionText: "text-[#a7b0bf]",
    dividerText: "text-[#a7b0bf]",
    identityPreviewEditButton: "text-[#fb923c]",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-[#fecaca]",
    logoBox: "h-10",
    logoImage: "max-h-10",
    socialButtonsBlockButton: "border-[#374151] bg-[#0f172a] hover:bg-[#1f2937]",
    formButtonPrimary: "bg-[#f97316] text-[#111827] hover:bg-[#fb923c] font-semibold",
    formFieldInput: "border-[#374151] bg-[#0f172a] text-[#f3f4f6]",
    footerAction: "bg-[#0f172a]",
    dividerLine: "bg-[#374151]",
    alert: "border-red-400/30 bg-red-400/10",
    otpCodeFieldInput: "border-[#374151] bg-[#0f172a] text-[#f3f4f6]",
    formFieldRow: "text-[#f3f4f6]",
    main: "text-[#f3f4f6]",
  },
};

function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      {mode === "sign-in" ? (
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      ) : (
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      )}
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/mypage" /></Show>
      <Show when="signed-out"><Home /></Show>
    </>
  );
}

function MyPageRoute() {
  return (
    <>
      <Show when="signed-in"><MyPage /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function ManagePage() {
  return (
    <>
      <Show when="signed-in"><CreatePoll /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function EditPollRoute() {
  return (
    <>
      <Show when="signed-in"><EditPoll /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function AdminDevelopmentRoute() {
  return (
    <>
      <Show when="signed-in"><AdminDevelopment /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function ClaimLegacyPollRoute() {
  return (
    <>
      <Show when="signed-in"><ClaimLegacyPoll /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/mypage" component={MyPageRoute} />
      <Route path="/manage" component={ManagePage} />
      <Route path="/sign-in/*?" component={() => <AuthPage mode="sign-in" />} />
      <Route path="/sign-up/*?" component={() => <AuthPage mode="sign-up" />} />
      <Route path="/feature-request" component={FeatureRequest} />
      <Route path="/feature-history" component={FeatureHistory} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/admin/development" component={AdminDevelopmentRoute} />
      <Route path="/claim-legacy-poll" component={ClaimLegacyPollRoute} />
      <Route path="/p/:shareId/edit" component={EditPollRoute} />
      <Route path="/p/:shareId" component={PollView} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "主催者ログイン", subtitle: "イベントを作成・管理するにはログインしてください" } },
        signUp: { start: { title: "主催者アカウントを作成", subtitle: "日程調整を始めましょう" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <Router />
    </ClerkProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
        <Toaster position="top-center" richColors />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
