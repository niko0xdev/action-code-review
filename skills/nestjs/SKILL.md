---
name: nestjs
description: NestJS (v10+) backend code review covering modules, providers, controllers, DTOs, guards, interceptors, exception filters, and lifecycle hooks. Use when reviewing NestJS applications for DI correctness, decorator usage, request scoping, async patterns, and testability.
---

# NestJS Code Review

When reviewing NestJS code, prioritize:

## Dependency Injection

- **Constructor injection preferred** over property injection — easier to test, explicit dependencies.
- **Use interfaces as tokens** for non-class providers (TypeORM repos, etc.):
  ```ts
  @Inject('USER_REPO') private repo: Repository<User>
  ```
- **Avoid circular dependencies**: if A imports B and B imports A, use `forwardRef(() => B)` as last resort. Better: refactor to a third module.
- **Module providers must be exported** to be visible to importing modules.

## Modules

- **Feature modules**: organize by domain (UsersModule, OrdersModule), not by technical layer (ServicesModule, ControllersModule).
- **Single responsibility**: each module owns one bounded context. Don't import unrelated providers.
- **Global modules**: only for truly cross-cutting concerns (ConfigModule, LoggerModule). Prefer explicit imports.

## Controllers

- **One route per handler**: `create`, `findAll`, `findOne`, `update`, `remove` — separate `@Get()`, `@Post()` etc.
- **DTOs + class-validator**: never accept raw `any` or entity classes in body. Validate at the boundary:
  ```ts
  class CreateUserDto {
    @IsEmail() email: string;
    @IsString() @MinLength(8) password: string;
  }
  ```
- **Response shape**: use `@SerializeOptions()` or interceptor to strip sensitive fields (password hash, internal IDs).
- **Status codes**: `@HttpCode(201)` for POST creating, `@HttpCode(204)` for DELETE. Default 200/201 is OK but be explicit.

## Guards & Interceptors

- **Guards for auth**: `@UseGuards(AuthGuard)` returns `false`/throws to deny. Use `@SetMetadata()` for custom guards.
- **Global guards**: register via `APP_GUARD` provider — but only for truly global concerns (auth, rate limit).
- **Interceptors for cross-cutting**: logging, caching, response transformation. Don't put business logic in interceptors.
- **Execution context**: in guards/interceptors, get request via `context.switchToHttp().getRequest()`.

## Async Pitfalls

- **Missing await**: NestJS interceptors that return without await lose side effects. Use `from()` rxjs operators or `async/await` consistently.
- **Promise.all vs sequential**: independent operations → `Promise.all([getA(), getB()])`. Sequential when B depends on A.
- **Unhandled rejections**: subscribe to streams with proper error handlers; NestJS will swallow unhandled promise rejections silently.
- **Fire-and-forget**: avoid `void someAsync()` without logging/error handling — exceptions disappear.

## Database & Transactions

- **Transactions**: use `dataSource.transaction(async (manager) => ...)` for multi-step writes. Don't rely on auto-commit behavior.
- **N+1 queries**: use `relations: ['user', 'posts']` in TypeORM `findOne` or query builder `leftJoinAndSelect`. Watch for nested relations causing more queries.
- **Pagination**: use `take`/`skip` or cursor-based — never load entire tables into memory.
- **Connection leaks**: with `DataSource` from `@nestjs/typeorm`, use `OnModuleDestroy` for cleanup. Pool exhaustion → 500 errors.

## Exception Handling

- **Domain exceptions**: create `UserNotFoundException extends NotFoundException` for clarity. NestJS auto-converts to HTTP responses.
- **Exception filter**: use `@Catch()` for custom error mapping (logging, sanitization).
- **Don't swallow errors**: catch only to add context, then rethrow with `throw new InternalServerErrorException('Failed to create user', { cause: err })`.

## Lifecycle Hooks

- **`OnModuleInit` / `OnModuleDestroy`**: use for resource setup/teardown. Async supported.
- **`OnApplicationBootstrap`**: after all modules initialized. Good for warming caches.
- **`@nestjs/schedule`**: cron jobs via `@Cron()`. Make idempotent — may run on multiple instances.

## Testing

- **Test files co-located**: `user.service.spec.ts` next to `user.service.ts`.
- **TestingModule**: use `Test.createTestingModule({ providers: [UserService] })` with mock providers.
- **Mock external dependencies**: TypeORM repos, HTTP clients — never hit real DB/HTTP in unit tests.
- **E2E with `supertest`**: NestJS provides `Test.createTestingModule` + `app.init()` for full app testing.

## Common Issues to Flag

- `any` type in service methods → defeats TypeScript.
- Missing `@Injectable()` decorator on providers → DI fails at runtime.
- `@Catch()` filter without `Error` base class → misses errors.
- Synchronous DB calls in async controllers → blocks event loop.
- Hardcoded secrets in `@nestjs/config` → use `ConfigService.get('JWT_SECRET')`.
- No DTO validation on POST endpoints → security risk.
