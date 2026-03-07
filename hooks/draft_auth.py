"""
MkDocs hook to inject a hashed draft password into config for template use.

Reads DRAFT_PASSWORD from environment (or .env file for local dev).
Hashes it with SHA-256 and stores in config.extra.draft_password_hash.
Templates use this hash to gate draft page content behind a password prompt.
"""
import hashlib
import os


def _load_env_file():
    """Load .env file if it exists (for local development)."""
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key not in os.environ:
                        os.environ[key] = value


def on_config(config):
    """Inject draft password hash into config for templates."""
    _load_env_file()

    password = os.environ.get('DRAFT_PASSWORD', '')
    if password:
        hash_val = hashlib.sha256(password.encode()).hexdigest()
        config['extra']['draft_password_hash'] = hash_val
    else:
        config['extra']['draft_password_hash'] = ''

    return config
