---
name: angular21
description: >
  Use this skill whenever the user wants to write, generate, scaffold, review, refactor,
  or debug Angular code. Trigger for any task involving Angular components, services,
  directives, pipes, routing, forms, state management, or Angular Material (mat) components.
  Also trigger for HTML templates, SCSS styling within Angular projects, standalone components,
  signals, signal forms, zoneless apps, Angular animations, or any Angular CLI tasks.
  Use even if the user just says "create a component", "add a mat-table", "write an Angular service",
  "style this with SCSS", or "use Angular Material for a dialog". Always use this skill for
  Angular-related code — do not rely on general knowledge alone.
---

# Angular 21 Coding Skill

You are an expert Angular 21 developer. Always write modern, idiomatic Angular 21 code
following the latest best practices. Read `references/patterns.md` for detailed code
patterns, and `references/angular-material.md` for Angular Material component guidance.

---

## Core Angular 21 Principles

### 1. Standalone Components by Default
All components, directives, and pipes are standalone. Never use NgModules unless
the user explicitly asks for legacy module-based architecture.

```typescript
@Component({
  selector: 'app-example',
  standalone: true,
  imports: [MatButtonModule, RouterLink], // ✅ No CommonModule needed — @if/@for are built-in
  templateUrl: './example.component.html',
  styleUrl: './example.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExampleComponent { }
```

### 2. Signals for State — Always
Use Angular Signals for all component state. Never use plain class properties
for reactive state. Avoid BehaviorSubject for local state.

```typescript
export class ExampleComponent {
  count = signal(0);
  doubled = computed(() => this.count() * 2);

  increment() {
    this.count.update(v => v + 1);
  }
}
```

### 3. Zoneless Change Detection
Zoneless is the default for new apps in Angular 21 and is production stable since v20.2.
Use `provideZonelessChangeDetection()` — NOT `provideExperimentalZonelessChangeDetection()` (that was the old experimental name, now removed).
Also add `provideBrowserGlobalErrorListeners()` which Angular 21 recommends alongside zoneless.

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),       // stable since v20.2 — not experimental
    provideBrowserGlobalErrorListeners(),   // recommended with zoneless for error handling
    provideRouter(routes),
    provideHttpClient(),
    provideAnimationsAsync(),
  ]
};
```

### 4. inject() for Dependency Injection
Always use the `inject()` function instead of constructor injection.

```typescript
// ✅ Correct
export class ExampleComponent {
  private router = inject(Router);
  private userService = inject(UserService);
}

// ❌ Avoid
constructor(private router: Router) {}
```

### 5. Modern Control Flow in Templates
Use Angular's built-in control flow syntax (`@if`, `@for`, `@switch`, `@defer`).
Never use `*ngIf`, `*ngFor`, or `*ngSwitch` directives.

```html
@if (user()) {
  <p>Welcome, {{ user()!.name }}</p>
} @else {
  <p>Please log in.</p>
}

@for (item of items(); track item.id) {
  <mat-list-item>{{ item.label }}</mat-list-item>
} @empty {
  <p>No items found.</p>
}

@defer (on viewport) {
  <app-heavy-chart />
} @placeholder {
  <mat-spinner />
}
```

### 6. Signal Forms (Angular 21 — Experimental)
Signal Forms are marked `@experimental` in Angular 21 — API may change in minor versions.
They are worth using in new projects but be aware of this status.

**Critical: correct import path is `@angular/forms/signals` NOT `@angular/forms`**
**Critical: `form()` takes a `signal()` wrapper around the model**
**Critical: `Field` directive must be imported from `@angular/forms/signals`**
**Critical: validators are standalone functions from `@angular/forms/signals`**

```typescript
// ✅ Correct Signal Forms API
import { form, submit } from '@angular/forms/signals';
import { Field, required, minLength } from '@angular/forms/signals';

export class ChatInputComponent {
  // form() wraps a signal() of the model object
  chatForm = form(signal({ message: '' }), (path) => {
    required(path.message);
    minLength(path.message, 1);
  });

  async send() {
    await submit(this.chatForm, (formValue) => {
      // only called when form is valid
      this.sendMessage(formValue.message);
    });
  }
}
```

```typescript
// Component must import Field directive
@Component({
  standalone: true,
  imports: [Field, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <form>
      <mat-form-field appearance="outline">
        <mat-label>Message</mat-label>
        <input matInput [field]="chatForm.message" />
        <mat-error>
          @for (err of chatForm.message.errors(); track err.kind) {
            {{ err.message }}
          }
        </mat-error>
      </mat-form-field>
      <button mat-flat-button (click)="send()">Send</button>
    </form>
  `,
})
export class ChatInputComponent { ... }
```

```typescript
// ❌ Wrong — old import path
import { form, field } from '@angular/forms';

// ❌ Wrong — form() does not take plain object directly
chatForm = form({ message: '' });

// ✅ Correct — form() wraps a signal()
chatForm = form(signal({ message: '' }));
```

If Signal Forms instability is a concern for this project, use ReactiveFormsModule as fallback — it is fully stable and perfectly fine for the chat input form.

### 7. TypeScript Best Practices
- Strict mode always (`"strict": true` in tsconfig)
- Typed inputs: `input<string>()`, `input.required<User>()`
- Typed outputs: `output<UserEvent>()`
- Generic `SimpleChanges<T>` in `ngOnChanges`
- No `any` — use `unknown` when type is truly uncertain

```typescript
export class UserCardComponent {
  user = input.required<User>();
  userSelected = output<User>();

  select() {
    this.userSelected.emit(this.user());
  }
}
```

---

## File & Folder Structure

Follow Angular's recommended structure:

```
src/
└── app/
    ├── core/
    │   ├── services/         # Singleton services (auth, api, etc.)
    │   ├── guards/
    │   └── interceptors/
    ├── shared/
    │   ├── components/       # Reusable UI components
    │   ├── directives/
    │   └── pipes/
    ├── features/
    │   └── feature-name/
    │       ├── components/
    │       ├── services/
    │       ├── models/
    │       └── feature.routes.ts
    ├── app.component.ts
    ├── app.config.ts
    └── app.routes.ts
```

Each component gets its own folder:
```
user-card/
├── user-card.component.ts
├── user-card.component.html
├── user-card.component.scss
└── user-card.component.spec.ts
```

---

## SCSS Guidelines

See `references/scss-patterns.md` for full SCSS conventions.

**Key rules:**
- Use Angular Material's theming system (`mat.define-theme`)
- Use CSS custom properties for design tokens
- Follow BEM naming: `.block__element--modifier`
- Use `:host` for component-level scoping
- Never use `::ng-deep` — prefer `ViewEncapsulation.None` or CSS vars
- Use `@use` not `@import` for SCSS modules

```scss
// Component SCSS example
:host {
  display: block;
  --card-padding: 16px;
}

.user-card {
  padding: var(--card-padding);

  &__header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__title {
    font: var(--mat-sys-title-medium);
    color: var(--mat-sys-on-surface);
  }

  &--highlighted {
    background: var(--mat-sys-primary-container);
  }
}
```

---

## Angular Material Rules

See `references/angular-material.md` for component-by-component guidance.

**Always:**
- Import only the specific Mat modules needed (tree-shakeable)
- Use `provideAnimationsAsync()` not `BrowserAnimationsModule`
- Use Material 3 theming tokens (`--mat-sys-*`) for custom colors
- Wrap inputs in `<mat-form-field>` with proper `<mat-label>` and `<mat-error>`

```typescript
// Import only what you use
imports: [
  MatButtonModule,
  MatCardModule,
  MatFormFieldModule,
  MatInputModule,
]
```

---

## Testing (Vitest)

Angular 21 uses Vitest by default. Write tests using Vitest syntax.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/angular';
import { UserCardComponent } from './user-card.component';

describe('UserCardComponent', () => {
  it('should display the user name', async () => {
    await render(UserCardComponent, {
      inputs: { user: { id: 1, name: 'Alice' } }
    });
    expect(screen.getByText('Alice')).toBeTruthy();
  });
});
```

---

## Code Generation Checklist

When generating any Angular code, verify:

- [ ] Component is standalone with explicit `imports: []`
- [ ] `ChangeDetectionStrategy.OnPush` is set
- [ ] `inject()` used, not constructor injection
- [ ] State managed via `signal()` / `computed()`
- [ ] Modern control flow used (`@if`, `@for`, `@defer`)
- [ ] Signal Forms used for forms — import from `@angular/forms/signals` not `@angular/forms`
- [ ] `form()` wraps `signal()` of the model: `form(signal({ ... }))`
- [ ] `Field` directive imported from `@angular/forms/signals` and added to `imports: []`
- [ ] Strict TypeScript — no `any`
- [ ] SCSS uses BEM + Material design tokens
- [ ] Mat modules individually imported
- [ ] `provideZonelessChangeDetection()` in app config (NOT `provideExperimentalZonelessChangeDetection`)
- [ ] `provideBrowserGlobalErrorListeners()` alongside zoneless provider
- [ ] `provideAnimationsAsync()` (not `BrowserAnimationsModule`)

---

## Reference Files

- **`references/patterns.md`** — Advanced patterns: services, routing, interceptors, guards, state with signals, lazy loading
- **`references/angular-material.md`** — Angular Material component usage: tables, dialogs, snackbars, form fields, theming
- **`references/scss-patterns.md`** — Full SCSS conventions, Material theming setup, responsive mixins

Read the relevant reference file before generating complex code.

---

## This Project: AI DevOps Copilot — Angular Specifics

### HTTP setup — connect to Node.js backend on :3000
```typescript
// app.config.ts — full config for this project
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([errorInterceptor])),
  ]
};
```

### Chat service pattern
```typescript
// src/app/core/services/chat.service.ts
@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:3000/api';

  sendMessage(message: string): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.baseUrl}/chat`, { message });
  }
}
```

### Message state — signals only
```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  timestamp: Date;
}

@Injectable({ providedIn: 'root' })
export class MessageStore {
  private _messages = signal<ChatMessage[]>([]);
  messages = this._messages.asReadonly();
  isLoading = signal(false);

  addMessage(msg: ChatMessage) {
    this._messages.update(msgs => [...msgs, msg]);
  }

  clear() { this._messages.set([]); }
}
```
