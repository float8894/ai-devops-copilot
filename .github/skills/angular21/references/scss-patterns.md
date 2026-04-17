# SCSS Patterns for Angular 21

## Global Setup

### styles.scss
```scss
@use '@angular/material' as mat;
@use 'sass:map';

// Define and apply theme (see angular-material.md for full theme setup)

// Global resets & base
*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  height: 100%;
  margin: 0;
  font-family: 'Inter', 'Roboto', sans-serif;
}

// Utility classes
.flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

.spacer { flex: 1 1 auto; }

// Snackbar overrides
.success-snackbar { --mdc-snackbar-container-color: #2e7d32; }
.error-snackbar   { --mdc-snackbar-container-color: #c62828; }
```

---

## Component SCSS Conventions

### File structure per component
```scss
// 1. Host styles
:host {
  display: block;           // or inline-block, flex, etc.
  --component-token: value; // component-scoped CSS vars
}

// 2. Root block
.component-name {
  // layout first, then visual

  // 3. Elements (BEM __)
  &__header { }
  &__body   { }
  &__footer { }

  // 4. Modifiers (BEM --)
  &--compact { }
  &--loading { }

  // 5. States
  &:hover  { }
  &:focus-visible { }
}
```

---

## BEM Naming

```scss
// Block
.user-card { }

// Element
.user-card__avatar  { }
.user-card__name    { }
.user-card__actions { }

// Modifier
.user-card--featured  { }
.user-card--skeleton  { }

// Combined
.user-card--compact .user-card__avatar {
  width: 32px;
}
```

---

## Material Design Tokens (M3)

Always use `--mat-sys-*` tokens instead of hard-coded colors.

### Color tokens
```scss
// Surfaces
var(--mat-sys-surface)
var(--mat-sys-surface-container)
var(--mat-sys-surface-container-high)
var(--mat-sys-surface-container-highest)

// Content
var(--mat-sys-on-surface)
var(--mat-sys-on-surface-variant)

// Primary
var(--mat-sys-primary)
var(--mat-sys-on-primary)
var(--mat-sys-primary-container)
var(--mat-sys-on-primary-container)

// Error
var(--mat-sys-error)
var(--mat-sys-error-container)

// Outline
var(--mat-sys-outline)
var(--mat-sys-outline-variant)
```

### Typography tokens
```scss
var(--mat-sys-display-large)     // hero headings
var(--mat-sys-headline-medium)   // page titles
var(--mat-sys-title-large)       // section headings
var(--mat-sys-title-medium)      // card titles
var(--mat-sys-body-large)        // primary body text
var(--mat-sys-body-medium)       // secondary body text
var(--mat-sys-label-large)       // button labels
var(--mat-sys-label-medium)      // chip labels, captions
```

### Shape (border-radius) tokens
```scss
var(--mat-sys-corner-extra-small)  // 4px
var(--mat-sys-corner-small)        // 8px
var(--mat-sys-corner-medium)       // 12px
var(--mat-sys-corner-large)        // 16px
var(--mat-sys-corner-extra-large)  // 28px
var(--mat-sys-corner-full)         // 50%
```

---

## Responsive Layout

### Breakpoint mixins
```scss
// _breakpoints.scss
$breakpoints: (
  'xs':  480px,
  'sm':  600px,
  'md':  960px,
  'lg':  1280px,
  'xl':  1920px,
);

@mixin respond-to($bp) {
  @media (min-width: map.get($breakpoints, $bp)) {
    @content;
  }
}

@mixin respond-below($bp) {
  @media (max-width: calc(#{map.get($breakpoints, $bp)} - 1px)) {
    @content;
  }
}
```

### Usage
```scss
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @include respond-to('md') {
    grid-template-columns: repeat(2, 1fr);
  }

  @include respond-to('lg') {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

---

## Layout Patterns

### Page layout
```scss
.page {
  display: flex;
  flex-direction: column;
  height: 100%;

  &__header {
    flex-shrink: 0;
    padding: 16px 24px;
  }

  &__content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  &__footer {
    flex-shrink: 0;
    padding: 16px 24px;
    border-top: 1px solid var(--mat-sys-outline-variant);
  }
}
```

### Card grid
```scss
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  padding: 16px;
}
```

---

## Common Component Patterns

### Skeleton loading
```scss
@keyframes skeleton-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  border-radius: var(--mat-sys-corner-small);
  background: linear-gradient(
    90deg,
    var(--mat-sys-surface-container) 25%,
    var(--mat-sys-surface-container-high) 50%,
    var(--mat-sys-surface-container) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
```

### Empty state
```scss
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--mat-sys-on-surface-variant);

  mat-icon {
    font-size: 64px;
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  &__title {
    font: var(--mat-sys-title-medium);
    margin-bottom: 8px;
  }

  &__message {
    font: var(--mat-sys-body-medium);
  }
}
```

---

## SCSS Best Practices

- Use `@use` not `@import`
- Keep nesting max 3 levels deep
- Component-specific variables go in `:host { --var: value; }`
- Shared design tokens → `styles.scss` or a `_tokens.scss` partial
- Animations → `_animations.scss` partial
- Never use `!important` except to override third-party styles
- Avoid `::ng-deep` — prefer CSS custom properties or `ViewEncapsulation.None`
- Use `transition` shorthand: `transition: all 200ms ease` for simple cases
