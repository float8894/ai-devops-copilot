# Angular Material (v21) – Component Reference

## Setup & Theming

### app.config.ts
```typescript
// Imports needed:
// import { provideZonelessChangeDetection, provideBrowserGlobalErrorListeners } from '@angular/core';
// import { provideRouter } from '@angular/router';
// import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
// import { provideHttpClient, withInterceptors } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),       // stable since v20.2
    provideBrowserGlobalErrorListeners(),   // recommended with zoneless
    provideAnimationsAsync(),               // NOT BrowserAnimationsModule
    provideRouter(routes),
    provideHttpClient(withInterceptors([])), // withInterceptors from @angular/common/http
  ]
};
```

### Material 3 Theme (styles.scss)
```scss
@use '@angular/material' as mat;

$theme: mat.define-theme((
  color: (
    theme-type: light,
    primary: mat.$azure-palette,
    tertiary: mat.$blue-palette,
  ),
  typography: (
    brand-family: 'Inter, sans-serif',
    bold-weight: 600,
  ),
  density: (
    scale: 0,
  ),
));

html {
  @include mat.all-component-themes($theme);
  @include mat.system-level-colors($theme);
  @include mat.system-level-typography($theme);
}
```

Use `--mat-sys-*` tokens in component SCSS for consistent theming:
```scss
.my-card {
  background: var(--mat-sys-surface-container);
  color: var(--mat-sys-on-surface);
  border-radius: var(--mat-sys-corner-medium);
}
```

---

## Form Fields

Always wrap inputs in `<mat-form-field>`. Include `<mat-label>` and `<mat-error>`.

```html
<mat-form-field appearance="outline">
  <mat-label>Email</mat-label>
  <input matInput type="email" [field]="form.controls.email" />
  <mat-hint>We'll never share your email.</mat-hint>
  <mat-error>
    @if (form.controls.email.hasError('required')) { Email is required. }
    @if (form.controls.email.hasError('email')) { Enter a valid email. }
  </mat-error>
</mat-form-field>
```

**Appearances:** `outline` (default, recommended), `fill`

---

## Buttons

```html
<!-- Filled (primary action) -->
<button mat-flat-button color="primary">Save</button>

<!-- Outlined (secondary action) -->
<button mat-stroked-button>Cancel</button>

<!-- Text (tertiary / nav) -->
<button mat-button>Learn more</button>

<!-- Icon button -->
<button mat-icon-button aria-label="Delete item">
  <mat-icon>delete</mat-icon>
</button>

<!-- FAB -->
<button mat-fab aria-label="Add">
  <mat-icon>add</mat-icon>
</button>
```

---

## Cards

```html
<mat-card appearance="outlined">
  <mat-card-header>
    <mat-card-title>User Profile</mat-card-title>
    <mat-card-subtitle>Last updated today</mat-card-subtitle>
  </mat-card-header>
  <mat-card-content>
    <p>Card body content here.</p>
  </mat-card-content>
  <mat-card-actions align="end">
    <button mat-button>Cancel</button>
    <button mat-flat-button color="primary">Save</button>
  </mat-card-actions>
</mat-card>
```

---

## Tables (mat-table)

**Note:** `mat-table` is the one place where Angular Material still requires structural directives
(`*matHeaderCellDef`, `*matCellDef`, `*matHeaderRowDef`, `*matRowDef`).
This is NOT a violation of the "no `*ngIf`/`*ngFor`" rule — these are Material-specific
column definition directives, not Angular core structural directives.

```typescript
imports: [MatTableModule, MatSortModule, MatPaginatorModule]

export class JobsTableComponent {
  jobs = input.required<JobRow[]>();
  displayedColumns = ['name', 'status', 'error', 'created_at'];
}
```

```html
<mat-table [dataSource]="jobs()" matSort>

  <ng-container matColumnDef="name">
    <mat-header-cell *matHeaderCellDef mat-sort-header>Job name</mat-header-cell>
    <mat-cell *matCellDef="let row">{{ row.name }}</mat-cell>
  </ng-container>

  <ng-container matColumnDef="status">
    <mat-header-cell *matHeaderCellDef>Status</mat-header-cell>
    <mat-cell *matCellDef="let row">
      <mat-chip [color]="row.status === 'failed' ? 'warn' : 'primary'">
        {{ row.status }}
      </mat-chip>
    </mat-cell>
  </ng-container>

  <ng-container matColumnDef="error">
    <mat-header-cell *matHeaderCellDef>Error</mat-header-cell>
    <mat-cell *matCellDef="let row">{{ row.error_message ?? '—' }}</mat-cell>
  </ng-container>

  <ng-container matColumnDef="created_at">
    <mat-header-cell *matHeaderCellDef mat-sort-header>Time</mat-header-cell>
    <mat-cell *matCellDef="let row">{{ row.created_at | date:'short' }}</mat-cell>
  </ng-container>

  <mat-header-row *matHeaderRowDef="displayedColumns" />
  <mat-row *matRowDef="let row; columns: displayedColumns;" />
  <tr class="mat-row" *matNoDataRow>
    <td class="mat-cell" [attr.colspan]="displayedColumns.length">No jobs found.</td>
  </tr>
</mat-table>

<mat-paginator [pageSizeOptions]="[10, 25, 50]" showFirstLastButtons />
```

---

## Dialogs

```typescript
imports: [MatDialogModule, MatButtonModule]

// Open
const ref = this.dialog.open(MyDialogComponent, {
  width: '500px',
  data: { userId: 42 },
  disableClose: true,
});

ref.afterClosed().subscribe((result: DialogResult | undefined) => {
  if (result) { /* handle result */ }
});
```

```html
<!-- Inside dialog component -->
<h2 mat-dialog-title>Edit User</h2>
<mat-dialog-content>
  <!-- form or content -->
</mat-dialog-content>
<mat-dialog-actions align="end">
  <button mat-button mat-dialog-close>Cancel</button>
  <button mat-flat-button color="primary" [mat-dialog-close]="result">Save</button>
</mat-dialog-actions>
```

---

## Snackbar

```typescript
private snackBar = inject(MatSnackBar);

showSuccess(msg: string) {
  this.snackBar.open(msg, 'Close', {
    duration: 3000,
    horizontalPosition: 'end',
    verticalPosition: 'top',
    panelClass: ['success-snackbar'],
  });
}
```

---

## Navigation (Sidenav + Toolbar)

```html
<mat-sidenav-container>
  <mat-sidenav #sidenav mode="side" opened>
    <mat-nav-list>
      <a mat-list-item routerLink="/dashboard" routerLinkActive="active">
        <mat-icon matListItemIcon>dashboard</mat-icon>
        <span matListItemTitle>Dashboard</span>
      </a>
    </mat-nav-list>
  </mat-sidenav>

  <mat-sidenav-content>
    <mat-toolbar color="primary">
      <button mat-icon-button (click)="sidenav.toggle()">
        <mat-icon>menu</mat-icon>
      </button>
      <span>My App</span>
    </mat-toolbar>
    <main class="main-content">
      <router-outlet />
    </main>
  </mat-sidenav-content>
</mat-sidenav-container>
```

---

## Chips

```html
<mat-chip-set>
  @for (tag of tags(); track tag) {
    <mat-chip (removed)="removeTag(tag)">
      {{ tag }}
      <button matChipRemove><mat-icon>cancel</mat-icon></button>
    </mat-chip>
  }
</mat-chip-set>
```

---

## Progress Indicators

```html
<!-- Determinate -->
<mat-progress-bar mode="determinate" [value]="progress()" />

<!-- Indeterminate (loading) -->
@if (loading()) {
  <mat-progress-bar mode="indeterminate" />
}

<!-- Spinner -->
<mat-spinner diameter="40" />
```

---

## Icons

Use Material Symbols (variable font). Add to `index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet" />
```

```html
<mat-icon>home</mat-icon>
<mat-icon fontSet="material-symbols-outlined">search</mat-icon>
```

---

## Select & Autocomplete

```html
<mat-form-field appearance="outline">
  <mat-label>Role</mat-label>
  <mat-select [field]="form.controls.role">
    @for (role of roles; track role.value) {
      <mat-option [value]="role.value">{{ role.label }}</mat-option>
    }
  </mat-select>
</mat-form-field>
```

---

## Tooltip & Badge

```html
<button mat-icon-button matTooltip="Delete this item" matTooltipPosition="above">
  <mat-icon>delete</mat-icon>
</button>

<button mat-icon-button [matBadge]="notificationCount()" matBadgeColor="warn">
  <mat-icon>notifications</mat-icon>
</button>
```
