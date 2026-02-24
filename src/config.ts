export const routeConfigs = [
    { prefix: "/sheep", compress: true, flush: true },
    { prefix: "/echo", compress: true, flush: true },
    { prefix: "/files/", compress: true, flush: false }, // Static files use high compression
];
