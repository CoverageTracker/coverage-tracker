export interface ThemeTokens {
  bg: string;
  card: string;
  elevated: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryFg: string;
  link: string;
  chart: [string, string, string];
  ring: string;
  accentFill: string;
}

export interface ThemeVariants {
  light?: ThemeTokens;
  dark?: ThemeTokens;
}

export interface ThemeFamily {
  id: string;
  label: string;
  variantNames?: { light?: string; dark?: string };
  variants: ThemeVariants;
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildVariant(
  v: Omit<ThemeTokens, 'ring' | 'accentFill'>,
): ThemeTokens {
  return {
    ...v,
    ring: hexAlpha(v.primary, 0.3),
    accentFill: hexAlpha(v.primary, 0.14),
  };
}

export const THEME_FAMILIES: ThemeFamily[] = [
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    variantNames: { light: 'Latte', dark: 'Mocha' },
    variants: {
      light: buildVariant({
        bg: '#eff1f5', card: '#ffffff', elevated: '#e6e9ef',
        text: '#4c4f69', muted: '#6c6f85', border: '#ccd0da',
        primary: '#1e66f5', primaryFg: '#ffffff', link: '#1e66f5',
        chart: ['#1e66f5', '#8839ef', '#179299'],
      }),
      dark: buildVariant({
        bg: '#181825', card: '#1e1e2e', elevated: '#313244',
        text: '#cdd6f4', muted: '#a6adc8', border: '#313244',
        primary: '#89b4fa', primaryFg: '#11111b', link: '#89b4fa',
        chart: ['#89b4fa', '#cba6f7', '#94e2d5'],
      }),
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    variants: {
      light: buildVariant({
        bg: '#f2e5bc', card: '#fbf1c7', elevated: '#ebdbb2',
        text: '#3c3836', muted: '#665c54', border: '#d5c4a1',
        primary: '#076678', primaryFg: '#fbf1c7', link: '#076678',
        chart: ['#076678', '#8f3f71', '#427b58'],
      }),
      dark: buildVariant({
        bg: '#1d2021', card: '#282828', elevated: '#3c3836',
        text: '#ebdbb2', muted: '#a89984', border: '#3c3836',
        primary: '#fabd2f', primaryFg: '#1d2021', link: '#83a598',
        chart: ['#fabd2f', '#d3869b', '#8ec07c'],
      }),
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    variantNames: { light: 'Snow Storm', dark: 'Polar Night' },
    variants: {
      light: buildVariant({
        bg: '#eceff4', card: '#ffffff', elevated: '#e5e9f0',
        text: '#2e3440', muted: '#4c566a', border: '#d8dee9',
        primary: '#5e81ac', primaryFg: '#ffffff', link: '#5e81ac',
        chart: ['#5e81ac', '#b48ead', '#a3be8c'],
      }),
      dark: buildVariant({
        bg: '#2e3440', card: '#3b4252', elevated: '#434c5e',
        text: '#eceff4', muted: '#aeb6c8', border: '#434c5e',
        primary: '#88c0d0', primaryFg: '#2e3440', link: '#88c0d0',
        chart: ['#88c0d0', '#b48ead', '#a3be8c'],
      }),
    },
  },
  {
    id: 'solarized',
    label: 'Solarized',
    variants: {
      light: buildVariant({
        bg: '#eee8d5', card: '#fdf6e3', elevated: '#e7e0c9',
        text: '#586e75', muted: '#657b83', border: '#ddd6c1',
        primary: '#268bd2', primaryFg: '#fdf6e3', link: '#268bd2',
        chart: ['#268bd2', '#d33682', '#859900'],
      }),
      dark: buildVariant({
        bg: '#002b36', card: '#073642', elevated: '#0a4250',
        text: '#93a1a1', muted: '#839496', border: '#0d4a59',
        primary: '#268bd2', primaryFg: '#fdf6e3', link: '#2aa198',
        chart: ['#268bd2', '#d33682', '#859900'],
      }),
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    variants: {
      dark: buildVariant({
        bg: '#21222c', card: '#282a36', elevated: '#343746',
        text: '#f8f8f2', muted: '#8a93c4', border: '#44475a',
        primary: '#bd93f9', primaryFg: '#21222c', link: '#8be9fd',
        chart: ['#bd93f9', '#ff79c6', '#50fa7b'],
      }),
    },
  },
  {
    id: 'tokyonight',
    label: 'Tokyo Night',
    variants: {
      dark: buildVariant({
        bg: '#16161e', card: '#1a1b26', elevated: '#292e42',
        text: '#c0caf5', muted: '#828bb8', border: '#292e42',
        primary: '#7aa2f7', primaryFg: '#16161e', link: '#7dcfff',
        chart: ['#7aa2f7', '#bb9af7', '#9ece6a'],
      }),
    },
  },
];

export type ThemeMode = 'light' | 'dark';

class ThemeState {
  familyId = $state('catppuccin');
  mode = $state<ThemeMode>('dark');
  menuOpen = $state(false);

  get family(): ThemeFamily {
    return THEME_FAMILIES.find((f) => f.id === this.familyId) ?? THEME_FAMILIES[0];
  }

  get tokens(): ThemeTokens {
    const v = this.family.variants;
    return (v[this.mode] ?? v.dark ?? v.light)!;
  }

  get canToggleMode(): boolean {
    const v = this.family.variants;
    return !!(v.light && v.dark);
  }

  get variantLabel(): string {
    return this.#variantName(this.family, this.mode);
  }

  #variantName(fam: ThemeFamily, mode: ThemeMode): string {
    const named = fam.variantNames?.[mode];
    if (named) return named;
    const v = fam.variants;
    if (!v.light) return 'Dark';
    if (!v.dark) return 'Light';
    return mode === 'dark' ? 'Dark' : 'Light';
  }

  variantNameFor(familyId: string, mode: ThemeMode): string {
    const fam = THEME_FAMILIES.find((f) => f.id === familyId) ?? THEME_FAMILIES[0];
    return this.#variantName(fam, mode);
  }

  setFamily(id: string) {
    this.familyId = id;
    const fam = THEME_FAMILIES.find((f) => f.id === id);
    if (fam) {
      if (!fam.variants[this.mode]) {
        this.mode = fam.variants.dark ? 'dark' : 'light';
      }
    }
    this.menuOpen = false;
    this.#persist();
  }

  toggleMode() {
    if (!this.canToggleMode) return;
    this.mode = this.mode === 'dark' ? 'light' : 'dark';
    this.#persist();
  }

  init() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('coverage-tracker-theme');
      if (stored) {
        const { familyId, mode } = JSON.parse(stored) as { familyId: string; mode: ThemeMode };
        const fam = THEME_FAMILIES.find((f) => f.id === familyId);
        if (fam) {
          this.familyId = familyId;
          this.mode = fam.variants[mode] ? mode : (fam.variants.dark ? 'dark' : 'light');
          return;
        }
      }
    } catch {
      // ignore bad stored value
    }
    // Seed from OS preference on first visit
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      this.mode = 'light';
    }
  }

  applyVars() {
    if (typeof document === 'undefined') return;
    const t = this.tokens;
    const root = document.documentElement;
    root.style.setProperty('--bg', t.bg);
    root.style.setProperty('--card', t.card);
    root.style.setProperty('--elevated', t.elevated);
    root.style.setProperty('--text', t.text);
    root.style.setProperty('--muted', t.muted);
    root.style.setProperty('--border', t.border);
    root.style.setProperty('--primary', t.primary);
    root.style.setProperty('--primary-fg', t.primaryFg);
    root.style.setProperty('--link', t.link);
    root.style.setProperty('--ring', t.ring);
    root.style.setProperty('--accent-fill', t.accentFill);
    root.style.setProperty('--chart-0', t.chart[0]);
    root.style.setProperty('--chart-1', t.chart[1]);
    root.style.setProperty('--chart-2', t.chart[2]);
  }

  #persist() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      'coverage-tracker-theme',
      JSON.stringify({ familyId: this.familyId, mode: this.mode }),
    );
  }
}

export const theme = new ThemeState();
