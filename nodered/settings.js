module.exports = {
    flowFile: 'flows.json',
    credentialSecret: false,
    flowFilePretty: true,
    uiPort: process.env.PORT || 1880,
    httpAdminRoot: '/node-red/',
    httpNodeRoot: '/node-red/',
    diagnostics: { enabled: true, ui: true },
    runtimeState: { enabled: false, ui: false },
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },
    editorTheme: {
        projects: { enabled: false }
    },
    functionGlobalContext: {},
    exportGlobalContextKeys: false,
    contextStorage: {
        default: { module: "memory" }
    }
};
