# SOLID

Esta base aplica SOLID de forma practica:

- SRP: rutas HTTP, errores, dominio, servicios e integraciones viven en carpetas distintas.
- OCP: nuevos codigos de error se agregan con `defineErrorCode` sin tocar
  handlers, siempre dentro del rango reservado del dominio.
- LSP: cualquier adaptador que cumpla `ItemStore` puede reemplazar `MemoryItemStore`.
- ISP: las interfaces exponen solo los metodos que el caso de uso necesita.
- DIP: `ItemService` depende de `ItemStore`, no de una clase concreta.
