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

// The star count on the GitHub button. Without the script, or if GitHub does not answer, the button is a plain link.
const star = document.querySelector('.star[data-repo]');
if (star) {
    fetch(`https://api.github.com/repos/${star.dataset.repo}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((repo) => {
            if (typeof repo?.stargazers_count !== 'number') return;
            const count = star.querySelector('.star-count');
            count.textContent = repo.stargazers_count.toLocaleString('en-US');
            count.hidden = false;
        })
        .catch(() => {});
}
