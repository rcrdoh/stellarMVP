# Agent integrations

`mongodb-checkpointer.ts` construye el checkpointer oficial de LangGraph sobre
MongoDB, conecta el cliente y ejecuta `setup()` para índices. El composition
root debe inyectarlo a `ShoppingAgent` y cerrar el cliente durante el apagado.
Esta integración no se conecta al servidor HTTP hasta que se defina su ciclo de
vida y configuración operativa.

`create-shopping-agent.ts` compone Shopping Agent con TypeSafe Jev y Groq desde
`Env`. El servicio de búsqueda y el cotizador siguen siendo dependencias
inyectadas porque todavía no hay implementaciones funcionales de esos casos de
uso. No se hacen llamadas externas al importar el módulo; la primera llamada
ocurre al evaluar una sesión.
