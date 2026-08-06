export class AuthManager {
  constructor() {
    this.token = localStorage.getItem('inachis_token');
  }

  isLoggedIn() {
    return !!this.token;
  }

  getToken() {
    return this.token;
  }

  setToken(t) {
    this.token = t;
    localStorage.setItem('inachis_token', t);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('inachis_token');
  }

  getAuthHeaders() {
    return { 'Authorization': `Bearer ${this.token}` };
  }

  // Parse JWT payload and return the role field (no verification — trust the server)
  getRole() {
    if (!this.token) return null;
    try {
      const payload = JSON.parse(atob(this.token.split('.')[1]));
      return payload.role || null;
    } catch {
      return null;
    }
  }

  logout() {
    this.clearToken();
    window.location.href = '/login';
  }

  async checkAuth() {
    if (!this.token) {
      window.location.href = '/login';
      return;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: this.getAuthHeaders()
      });

      const contentType = response.headers.get('content-type');

      if (!response.ok) {
        this.logout();
        return;
      }

      if (!contentType?.includes('application/json')) {
        this.logout();
        return;
      }

      const user = await response.json();
      if (!user || user.role !== 'admin') {
        this.logout();
      }
    } catch (err) {
      this.logout();
    }
  }

  // Like checkAuth but for friend role — redirects to /login if not a friend
  async checkFriendAuth() {
    if (!this.token) {
      window.location.href = '/login';
      return false;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: this.getAuthHeaders()
      });

      const contentType = response.headers.get('content-type');

      if (!response.ok) {
        this.logout();
        return false;
      }

      if (!contentType?.includes('application/json')) {
        this.logout();
        return false;
      }

      const user = await response.json();
      if (!user || user.role !== 'friend') {
        window.location.href = '/login';
        return false;
      }
      return true;
    } catch (err) {
      this.logout();
      return false;
    }
  }
}
