(() => {
  const attach = () => {
    const inputs = document.querySelectorAll('input[type="password"]');
    inputs.forEach((input) => {
      if (input.dataset.passwordToggleAttached === "true") return;
      input.dataset.passwordToggleAttached = "true";
      const wrap = document.createElement("div");
      wrap.className = "password-wrap";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "password-toggle";
      button.textContent = "Show";
      button.setAttribute("aria-label", "Show password");
      button.addEventListener("click", () => {
        const visible = input.type === "text";
        input.type = visible ? "password" : "text";
        button.textContent = visible ? "Show" : "Hide";
        button.setAttribute("aria-label", visible ? "Show password" : "Hide password");
      });
      wrap.appendChild(button);
    });
  };

  attach();
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
})();
