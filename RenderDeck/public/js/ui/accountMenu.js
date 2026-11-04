import * as Auth from '../io/sync/authClient.js';

const MODES = {
  login: { title: 'Sign in', submit: 'Sign in', fields: [['email', 'Email', 'email'], ['password', 'Password', 'password']] },
  register: { title: 'Create account', submit: 'Create account', fields: [['email', 'Email', 'email'], ['password', 'Password (at least 10 characters)', 'password']] },
  forgot: { title: 'Reset password', submit: 'Send reset link', fields: [['email', 'Email', 'email']] },
  reset: { title: 'Choose a new password', submit: 'Reset password', fields: [['password', 'New password (at least 10 characters)', 'password']] },
  change: { title: 'Change password', submit: 'Change password', fields: [['currentPassword', 'Current password', 'password'], ['password', 'New password (at least 10 characters)', 'password']] },
  delete: { title: 'Delete account', submit: 'Delete account', fields: [['password', 'Password', 'password']], danger: true },
  verify: { title: 'Verify email', submit: 'Verify email', fields: [] },
};

export function initAccountMenu(host) {
  if (!host) return;
  const menu = document.createElement('div');
  menu.className = 'account-control';
  host.replaceChildren(menu);
  const ui = {
    menu,
    mailEnabled: false,
    modal: null,
    mode: null,
    linkToken: null,
    linkType: null,
  };
  menu.innerHTML = `
    <button class="account-trigger" type="button" aria-haspopup="true" aria-expanded="false"></button>
    <div class="account-dropdown" hidden></div>
  `;
  const trigger = menu.querySelector('.account-trigger');
  const dropdown = menu.querySelector('.account-dropdown');
  trigger.addEventListener('click', () => {
    dropdown.hidden = !dropdown.hidden;
    trigger.setAttribute('aria-expanded', String(!dropdown.hidden));
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target)) {
      dropdown.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  Auth.onSessionChange(() => renderMenu(ui));
  renderMenu(ui);
  Auth.initializeSession().catch(() => {});
  Auth.getHealth().then(health => {
    ui.mailEnabled = health.mailEnabled === true;
    renderMenu(ui);
    if (ui.modal && !ui.modal.hidden && ui.mode === 'login') {
      const email = ui.modal.querySelector('[name="email"]')?.value || '';
      renderModal(ui, '', false, { email });
    }
  }).catch(() => {});

  const link = window.__consumeRenderDeckAccountLink?.();
  if (link?.token) {
    ui.linkToken = link.token;
    ui.linkType = link.type;
    openModal(ui, link.type === 'reset' ? 'reset' : 'verify');
  }
}

function renderMenu(ui) {
  const trigger = ui.menu.querySelector('.account-trigger');
  const dropdown = ui.menu.querySelector('.account-dropdown');
  const user = Auth.getCurrentUser();
  trigger.textContent = user ? user.email : 'Sign in';
  trigger.classList.toggle('account-trigger--signed-in', Boolean(user));
  dropdown.replaceChildren();
  if (!user) {
    addMenuButton(dropdown, 'Sign in', () => openModal(ui, 'login'));
    addMenuButton(dropdown, 'Create account', () => openModal(ui, 'register'));
    return;
  }
  const label = document.createElement('div');
  label.className = 'account-dropdown-label';
  label.textContent = user.email;
  dropdown.append(label);
  if (ui.mailEnabled && !user.emailVerifiedAt) {
    addMenuButton(dropdown, 'Resend verification email', () => {
      closeDropdown(ui);
      runAction(ui, 'Sending verification email…', () => Auth.resendVerification({
        onWake: message => setModalStatus(ui, message),
      }));
    });
  }
  addMenuButton(dropdown, 'Change password', () => openModal(ui, 'change'));
  addMenuButton(dropdown, 'Delete account', () => openModal(ui, 'delete'), true);
  addMenuButton(dropdown, 'Sign out', () => runAction(ui, 'Signing out…', () => Auth.logout({ onWake: message => setModalStatus(ui, message) })));
}

function addMenuButton(container, label, action, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `account-menu-item${danger ? ' account-menu-item--danger' : ''}`;
  button.textContent = label;
  button.addEventListener('click', action);
  container.append(button);
}

function closeDropdown(ui) {
  const dropdown = ui.menu.querySelector('.account-dropdown');
  dropdown.hidden = true;
  ui.menu.querySelector('.account-trigger').setAttribute('aria-expanded', 'false');
}

function openModal(ui, mode) {
  closeDropdown(ui);
  ui.mode = mode;
  if (!ui.modal) {
    ui.modal = document.createElement('div');
    ui.modal.className = 'account-modal-backdrop';
    ui.modal.addEventListener('click', event => {
      if (event.target === ui.modal) closeModal(ui);
    });
    document.body.append(ui.modal);
  }
  renderModal(ui);
  ui.modal.hidden = false;
  ui.modal.querySelector('input')?.focus();
}

function renderModal(ui, message = '', isError = false, values = {}) {
  const config = MODES[ui.mode];
  const fields = config.fields.map(([name, label, type]) => `
    <label class="account-field">
      <span>${label}</span>
      <input name="${name}" type="${type}" ${type === 'email' ? 'autocomplete="email"' : `autocomplete="${name === 'password' && ['register', 'reset', 'change'].includes(ui.mode) ? 'new-password' : 'current-password'}"`} required ${name === 'password' && ui.mode !== 'change' ? 'minlength="10"' : ''}>
    </label>
  `).join('');
  const links = ui.mode === 'login'
    ? `<div class="account-modal-links"><button type="button" data-mode="register">Create account</button>${ui.mailEnabled ? '<button type="button" data-mode="forgot">Forgot password?</button>' : ''}</div>`
    : ui.mode === 'register'
      ? '<div class="account-modal-links"><button type="button" data-mode="login">Already have an account? Sign in</button></div>'
      : ui.mode === 'forgot' || ui.mode === 'reset'
        ? '<div class="account-modal-links"><button type="button" data-mode="login">Back to sign in</button></div>'
        : '';
  ui.modal.innerHTML = `
    <section class="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
      <button class="account-modal-close" type="button" aria-label="Close">×</button>
      <h2 id="account-modal-title">${config.title}</h2>
      ${ui.mode === 'delete' ? '<p class="account-modal-description">This permanently deletes your account and its server-stored files.</p>' : ''}
      <p class="account-modal-status${isError ? ' account-modal-status--error' : ''}" aria-live="polite"></p>
      <form class="account-form" novalidate>
        ${fields}
        <div class="account-modal-actions">
          <button type="button" class="account-secondary">Cancel</button>
          <button type="submit" class="account-primary${config.danger ? ' account-primary--danger' : ''}">${config.submit}</button>
        </div>
      </form>
      ${links}
    </section>
  `;
  ui.modal.querySelector('.account-modal-status').textContent = message;
  for (const [name, value] of Object.entries(values)) {
    const input = ui.modal.querySelector(`[name="${name}"]`);
    if (input) input.value = value;
  }
  ui.modal.querySelector('.account-modal-close').addEventListener('click', () => closeModal(ui));
  ui.modal.querySelector('.account-secondary').addEventListener('click', () => closeModal(ui));
  ui.modal.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => openModal(ui, button.dataset.mode));
  });
  ui.modal.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    submitModal(ui, event.currentTarget);
  });
  if (ui.mode === 'verify' && ui.linkToken) {
    const form = ui.modal.querySelector('form');
    form.querySelector('.account-modal-actions').innerHTML = `
      <button type="button" class="account-secondary">Cancel</button>
      <button type="submit" class="account-primary">Verify email</button>
    `;
    form.querySelector('.account-secondary').addEventListener('click', () => closeModal(ui));
  }
}

async function submitModal(ui, form) {
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  if (ui.mode !== 'verify' && !form.reportValidity()) return;
  submit.disabled = true;
  setModalStatus(ui, '');
  const run = async action => {
    try {
      await action();
    } catch (error) {
      setModalStatus(ui, error.message || 'The request could not be completed.', true);
      submit.disabled = false;
    }
  };
  const wake = message => setModalStatus(ui, message);
  switch (ui.mode) {
    case 'login':
      return run(async () => {
        await Auth.login(values.email.trim(), values.password, { onWake: wake });
        setModalStatus(ui, 'You are signed in.');
        closeModal(ui);
      });
    case 'register':
      return run(async () => {
        await Auth.register(values.email.trim(), values.password, { onWake: wake });
        closeModal(ui);
      });
    case 'forgot':
      return run(async () => {
        await Auth.passwordForgot(values.email.trim(), { onWake: wake });
        setModalStatus(ui, 'If an account matches that email, a password reset link will be sent.');
        submit.disabled = true;
      });
    case 'reset':
      return run(async () => {
        await Auth.passwordReset(ui.linkToken, values.password, { onWake: wake });
        ui.linkToken = null;
        setModalStatus(ui, 'Your password has been reset. You can now sign in.');
        ui.mode = 'login';
        renderModal(ui, 'Your password has been reset. You can now sign in.');
      });
    case 'verify':
      return run(async () => {
        await Auth.verifyEmail(ui.linkToken, { onWake: wake });
        ui.linkToken = null;
        setModalStatus(ui, 'Your email has been verified.');
        submit.disabled = true;
      });
    case 'change':
      return run(async () => {
        await Auth.passwordChange(values.currentPassword, values.password, { onWake: wake });
        setModalStatus(ui, 'Your password has been changed. Sign in again to continue.');
        await Auth.logout({ onWake: wake });
        submit.disabled = true;
      });
    case 'delete':
      return run(async () => {
        await Auth.deleteAccount(values.password, { onWake: wake });
        setModalStatus(ui, 'Your account has been deleted.');
        submit.disabled = true;
      });
  }
}

function runAction(ui, message, action) {
  openModal(ui, 'login');
  ui.mode = null;
  ui.modal.innerHTML = `
    <section class="account-modal" role="dialog" aria-modal="true">
      <button class="account-modal-close" type="button" aria-label="Close">×</button>
      <p class="account-modal-status" aria-live="polite"></p>
    </section>
  `;
  setModalStatus(ui, message);
  ui.modal.querySelector('.account-modal-close').addEventListener('click', () => closeModal(ui));
  Promise.resolve().then(action).then(() => closeModal(ui)).catch(error => {
    ui.mode = 'login';
    renderModal(ui, error.message || 'The request could not be completed.', true);
  });
}

function setModalStatus(ui, message, isError = false) {
  const status = ui.modal?.querySelector('.account-modal-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('account-modal-status--error', isError);
}

function closeModal(ui) {
  if (ui.modal) ui.modal.hidden = true;
  ui.linkToken = null;
  ui.linkType = null;
}
