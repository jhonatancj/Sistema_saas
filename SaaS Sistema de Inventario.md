---
tipo: proyecto
repo: /Users/jhonatancj/Documents/develop/cj/Sistema_inventario
---

# SaaS Sistema de Inventario

Nota raíz del proyecto — vive en la raíz del repo junto a `CLAUDE.md`.

## Qué es

SaaS multi-tenant de inventario y ventas. Backend NestJS sin ORM (`pg` directo +
SQL crudo) + Frontend Angular 22 standalone/signals + PostgreSQL schema-per-tenant
(`public` para super admin/tenants, `tenant_<slug>` por empresa).

No es un ERP de módulos fijos: es un motor low-code de formularios dinámicos — un
builder arma un JSON de formulario y el backend genera automáticamente la tabla y
el stored procedure para persistirlo. Los "módulos de negocio" son composiciones de
formularios, no entidades de dominio codificadas.

## Dónde vive el código

`/Users/jhonatancj/Documents/develop/cj/Sistema_inventario`
- `Back/api/` — NestJS
- `Front/` — Angular 22

## Mapa de documentación

- `CLAUDE.md` (raíz) — reglas de trabajo, arquitectura vigente, convenciones
  obligatorias. Punto de entrada antes de tocar código.
- `CURRENT_STATE.md` (raíz) — único archivo de estado vivo: último trabajo,
  estado actual, bugs abiertos, riesgos, próximas prioridades.
- `docs/adr/` — decisiones arquitectónicas importantes, una por archivo.
- `docs/known-bugs.md` — patrones de bug conocidos con causa raíz y fix.

Convención de trabajo completa (qué leer antes, qué actualizar al terminar):
ver `CLAUDE.md` → "Antes de cualquier tarea" / "Flujo de documentación".
