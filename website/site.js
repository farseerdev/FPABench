// The theme switch. The pages work without this script, only the switch needs it.

for (const button of document.querySelectorAll('[data-theme-choice]')) {
    button.addEventListener('click', () => {
        const theme = button.dataset.themeChoice;
        document.documentElement.dataset.theme = theme;
        try {
            localStorage.setItem('fpabench-theme', theme);
        } catch {
            // Storage can be blocked. The choice then lasts until the page reloads.
        }
    });
}
