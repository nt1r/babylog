import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type ThemeMode, usePreferencesStore } from '@/stores/preferences';

const THEME_LABELS: Record<ThemeMode, string> = {
  light: '浅色模式',
  dark: '深色护眼',
  system: '跟随系统',
};

export function ThemeSwitcher({ showTooltip = true }: { showTooltip?: boolean }) {
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const resolvedTheme = usePreferencesStore((state) => state.resolvedTheme);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);

  const TriggerIcon = resolvedTheme === 'dark' ? MoonIcon : SunIcon;

  const trigger = (
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`切换外观主题（当前：${THEME_LABELS[themeMode]}）`}
        />
      }
    >
      <TriggerIcon className="size-4" strokeWidth={1.8} />
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {showTooltip ? (
        <Tooltip>
          <TooltipTrigger render={trigger} />
          <TooltipContent>切换主题（{THEME_LABELS[themeMode]}）</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}

      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup
          value={themeMode}
          onValueChange={(value) => {
            if (value === 'light' || value === 'dark' || value === 'system') {
              setThemeMode(value);
            }
          }}
        >
          <DropdownMenuRadioItem value="light">
            <SunIcon className="size-4" />
            浅色模式
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon className="size-4" />
            深色护眼
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon className="size-4" />
            跟随系统
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
