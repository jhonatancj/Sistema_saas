# ADR-008: Allow-list de formularios del catálogo por tenant

## Contexto
`public.forms` es un catálogo compartido de plantillas. Sin restricción,
cualquier tenant podía asignarse a sus módulos cualquier formulario del
catálogo — no había forma de ofrecer un formulario a un tenant específico sin
ofrecerlo a todos.

Se evaluó atar esto a `subscription_plans`/planes — descartado: esas tablas
están 100% sin uso en el código (ni un endpoint las lee), y el usuario pidió
control directo por tenant, no por plan.

## Decisión
`public.tenants.form_access_mode` (`'all' | 'restricted'`, default `'all'` —
ningún tenant existente pierde acceso al introducir la columna) +
`public.tenant_allowed_forms` (allow-list explícita cuando el modo es
`restricted`).

`FormAccessService.resolveAssignability(schema)` es la **única fuente de
verdad** de "¿este slug es asignable para este tenant?" — la usan tanto
`FormExecutorService.getForms()` (filtra el listado) como
`ModulesService.setTenantModuleForms()` (rechaza con 400), así los dos puntos
de enforcement nunca pueden divergir.

Regla: un formulario **propio** del tenant (no publicado en `public.forms`)
nunca se restringe — el modo `restricted` solo gatea contenido del catálogo
compartido.

## Consecuencias / deuda aceptada
- Asignaciones ya existentes en `module_forms` no se podan retroactivamente si
  se restringe un tenant después — siguen funcionando hasta que el tenant
  vuelva a guardar ese módulo.
- `getForm()`/`execute()` no gatean acceso a **datos** de un formulario ya
  asignado — el alcance de este control es listar/asignar, no bloqueo de
  runtime.
- `syncPublicModulesToTenant()` (sync masivo, ver ADR-001) no pasa por
  `setTenantModuleForms()` — un super admin podría re-poblar `module_forms`
  con slugs no permitidos vía "sincronizar módulos". Gap conocido, no cerrado.
