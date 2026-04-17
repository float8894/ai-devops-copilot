# Angular 21 – Advanced Patterns Reference

## Services & Dependency Injection

### Singleton Service (root-provided)
```typescript
@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  getUsers(): Observable<User[]> {
    return this.http.get<User[]>('/api/users');
  }
}
```

### Resource API (Signal-based async)
Use `resource()` for async data fetching tied to signals.
Import `resource` from `@angular/core` (available since Angular 19, stable in 21).

```typescript
import { resource, signal, inject } from '@angular/core';

export class ChatPageComponent {
  private chatService = inject(ChatService);
  conversationId = signal<string | null>(null);

  messages = resource({
    request: () => ({ id: this.conversationId() }),
    loader: ({ request }) =>
      request.id
        ? this.chatService.getMessages(request.id)
        : Promise.resolve([])
  });
}
```

```html
@if (products.isLoading()) {
  <mat-spinner />
} @else if (products.error()) {
  <p class="error">Failed to load products.</p>
} @else {
  @for (p of products.value(); track p.id) {
    <app-product-card [product]="p" />
  }
}
```

---

## Routing

### Lazy-loaded feature routes
```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component')
        .then(m => m.DashboardComponent),
  },
  {
    path: 'users',
    loadChildren: () =>
      import('./features/users/users.routes')
        .then(m => m.USER_ROUTES),
  },
];
```

### Route Guards
```typescript
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url }
  });
};
```

### Route Resolvers with Signals
```typescript
export const userResolver: ResolveFn<User> = (route) => {
  return inject(UserService).getById(Number(route.paramMap.get('id')));
};
```

---

## HTTP Interceptors

```typescript
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();

  if (token) {
    req = req.clone({
      headers: req.headers.set('Authorization', `Bearer ${token}`)
    });
  }
  return next(req);
};

// Register in app.config.ts
provideHttpClient(withInterceptors([authInterceptor]))
```

---

## State Management with Signals

### Simple signal store (no NgRx needed for small apps)
```typescript
@Injectable({ providedIn: 'root' })
export class CartStore {
  private _items = signal<CartItem[]>([]);

  // Public read-only
  items = this._items.asReadonly();
  total = computed(() =>
    this._items().reduce((sum, i) => sum + i.price * i.quantity, 0)
  );
  count = computed(() => this._items().length);

  addItem(item: CartItem) {
    this._items.update(items => [...items, item]);
  }

  removeItem(id: string) {
    this._items.update(items => items.filter(i => i.id !== id));
  }

  clear() {
    this._items.set([]);
  }
}
```

---

## Reusable Dialog Pattern

```typescript
// Typed dialog data
export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-button color="warn" [mat-dialog-close]="true">
        {{ data.confirmLabel ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialogComponent {
  data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}

// Usage
export class SomeComponent {
  private dialog = inject(MatDialog);

  openConfirm() {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete?', message: 'This cannot be undone.' } satisfies ConfirmDialogData,
      width: '400px',
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) this.deleteItem();
    });
  }
}
```

---

## Pipes

### Custom pipe (standalone)
```typescript
@Pipe({ name: 'truncate', standalone: true, pure: true })
export class TruncatePipe implements PipeTransform {
  transform(value: string, limit = 50): string {
    return value.length > limit ? `${value.slice(0, limit)}…` : value;
  }
}
```

---

## Error Handling

### Global error handler
```typescript
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private snackBar = inject(MatSnackBar);

  handleError(error: unknown): void {
    // In production, send to your logging service — never use console.error
    // For this project: the Angular frontend error handler should call
    // a logging endpoint on the Node.js backend if needed
    const message = error instanceof Error ? error.message : 'Unknown error';
    this.snackBar.open('An unexpected error occurred.', 'Dismiss', {
      duration: 5000,
      panelClass: ['error-snackbar'],
    });
  }
}

// app.config.ts
providers: [{ provide: ErrorHandler, useClass: GlobalErrorHandler }]
```

---

## Performance Tips

- Always use `ChangeDetectionStrategy.OnPush`
- Use `@defer` for below-the-fold content
- Use `trackBy` equivalent in `@for`: always provide `track item.id`
- Prefer `resource()` over manual subscriptions for async data
- Use `input()` signal inputs to eliminate `ngOnChanges` boilerplate
- Avoid `effect()` for derived state — use `computed()` instead
- Use `linkedSignal()` for signals that need to reset when a dependency changes
