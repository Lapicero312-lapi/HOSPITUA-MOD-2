/**
 * Reglas de la arquitectura hexagonal del backend (plan base, "Arquitectura hexagonal").
 * Las dependencias siempre apuntan hacia adentro:  infrastructure -> application -> domain.
 * Se ejecutan con `pnpm lint` (y por tanto en el CI): una PR que las rompa no se puede integrar.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'sin-ciclos',
      severity: 'error',
      comment:
        'Dos archivos no pueden depender el uno del otro, ni directa ni indirectamente.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-no-importa-capas-externas',
      severity: 'error',
      comment: 'domain/ no importa nada de application/ ni de infrastructure/.',
      from: { path: '^src/domain' },
      to: { path: '^src/(application|infrastructure)' },
    },
    {
      name: 'domain-sin-librerias',
      severity: 'error',
      comment:
        'domain/ es TypeScript puro: nada de Nest, TypeORM ni RabbitMQ. Solo se permite decimal.js (dinero).',
      from: { path: '^src/domain' },
      to: {
        dependencyTypes: [
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-no-pkg',
          'npm-unknown',
        ],
        pathNot: 'node_modules/decimal\\.js',
      },
    },
    {
      name: 'application-no-importa-infrastructure',
      severity: 'error',
      comment:
        'application/ solo conoce el dominio; a la infraestructura la llama por puertos.',
      from: { path: '^src/application' },
      to: { path: '^src/infrastructure' },
    },
    {
      name: 'application-sin-librerias-de-infraestructura',
      severity: 'error',
      comment:
        'application/ no usa TypeORM, clientes HTTP, RabbitMQ ni el servidor web: eso es de infrastructure/.',
      from: { path: '^src/application' },
      to: {
        path: 'node_modules/(typeorm|pg|@nestjs/typeorm|@nestjs/axios|axios|amqplib|amqp-connection-manager|@golevelup|@nestjs/schedule|pino|nestjs-pino|express|@nestjs/platform-express)(/|$)',
      },
    },
    {
      name: 'entrada-no-usa-salida',
      severity: 'error',
      comment:
        'Los controladores, consumidores y tareas (infrastructure/in) solo llaman a un caso de uso, no a los adaptadores de salida.',
      from: { path: '^src/infrastructure/in' },
      to: { path: '^src/infrastructure/out' },
    },
    {
      name: 'salida-no-usa-entrada',
      severity: 'error',
      comment:
        'Los adaptadores de salida (infrastructure/out) no dependen de los de entrada.',
      from: { path: '^src/infrastructure/out' },
      to: { path: '^src/infrastructure/in' },
    },
    {
      name: 'src-no-importa-test',
      severity: 'error',
      comment: 'El código de la aplicación no depende de las pruebas.',
      from: { path: '^src' },
      to: { path: '^test' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    // El proyecto es ESM: los imports llevan ".js" aunque el archivo sea ".ts"; dependency-cruiser lo resuelve solo.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
