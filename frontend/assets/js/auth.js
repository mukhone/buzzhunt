// Auth page functionality

const API_URL = '/api';

// DOM Elements
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const loginFormElement = document.getElementById('loginFormElement');
const signupFormElement = document.getElementById('signupFormElement');
const showSignupLink = document.getElementById('showSignup');
const showLoginLink = document.getElementById('showLogin');
const loginError = document.getElementById('loginError');
const signupError = document.getElementById('signupError');

// Check if user is already logged in
if (localStorage.getItem('token')) {
  window.location.href = '/dashboard.html';
}

// Toggle between login and signup forms
showSignupLink.addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.style.display = 'none';
  signupForm.style.display = 'block';
  loginError.textContent = '';
});

showLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  signupForm.style.display = 'none';
  loginForm.style.display = 'block';
  signupError.textContent = '';
});

// Login form submission
loginFormElement.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Save token and user info
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    // Redirect to dashboard
    window.location.href = '/dashboard.html';
  } catch (error) {
    loginError.textContent = error.message;
  }
});

// Signup form submission
signupFormElement.addEventListener('submit', async (e) => {
  e.preventDefault();
  signupError.textContent = '';

  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupConfirmPassword').value;

  // Validate passwords match
  if (password !== confirmPassword) {
    signupError.textContent = 'Passwords do not match';
    return;
  }

  // Validate password length
  if (password.length < 6) {
    signupError.textContent = 'Password must be at least 6 characters';
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password, confirmPassword })
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.errors && data.errors.length > 0) {
        throw new Error(data.errors[0].msg);
      }
      throw new Error(data.error || 'Signup failed');
    }

    // Save token and user info
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    // Redirect to dashboard
    window.location.href = '/dashboard.html';
  } catch (error) {
    signupError.textContent = error.message;
  }
});
