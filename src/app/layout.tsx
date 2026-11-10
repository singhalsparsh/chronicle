import type { Metadata, Viewport } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceProvider } from "@/lib/workspace-context";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Chronicle · Project State Reconstruction & Handover",
  description:
    "Evidence-linked project state reconstruction and permissioned handover for Core-Payments-Service.",
};

const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('chronicle-theme');
    var dark = stored ? stored === 'dark' : true;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider delay={150}>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
