import type { ReactNode } from 'react';
import { AdminHeader } from '@/components/app-shell/admin-header';
import { AppSidebar } from '@/components/app-shell/app-sidebar';
import { CommandPalette } from '@/components/app-shell/command-palette';
import { MobileTabBar } from '@/components/app-shell/mobile-tabbar';
import { AddBabyDialog } from '@/components/baby/add-baby-dialog';
import { BatchRecordDrawer } from '@/components/batch-record/batch-record-drawer';
import { GrowthRecordDrawer } from '@/components/growth/growth-record-drawer';
import { ExportExcelDrawer } from '@/components/insights/export-excel-drawer';
import { QuickRecordDrawer } from '@/components/quick-record-drawer';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        跳至主要内容
      </a>

      <AppSidebar />

      <SidebarInset>
        <AdminHeader />
        <div
          id="main-content"
          className="@container/main mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:gap-6 md:px-6 md:py-6"
        >
          {children}
        </div>
      </SidebarInset>

      <MobileTabBar />
      <CommandPalette />
      <AddBabyDialog />
      <QuickRecordDrawer />
      <BatchRecordDrawer />
      <GrowthRecordDrawer />
      <ExportExcelDrawer />
    </SidebarProvider>
  );
}
