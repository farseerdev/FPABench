// Loaded with node --import when the FPABench runner is started on Windows. The runner passes absolute
// paths to import(), which Node accepts only as file:// URLs there. This hook converts them, so the runner
// itself does not have to be changed.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^[a-zA-Z]:[\\/]/.test(specifier)) return { url: pathToFileURL(specifier).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
