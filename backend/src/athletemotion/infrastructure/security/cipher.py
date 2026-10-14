"""Cifra a nível de campo (Field-Level Encryption) para conformidade com o RGPD (Art. 9 e 32).

Protege dados pessoais identificáveis (PII) e dados biométricos em repouso
(como emails e raw landmarks de pose) através do algoritmo simétrico Fernet (AES-128-CBC + HMAC-SHA256).
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import logging
import os
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import String, Text, TypeDecorator

from athletemotion.config.paths import APP_DATA_DIR

logger = logging.getLogger(__name__)

CIPHER_PREFIX = "enc:v1:"


def _derive_fernet_key(raw_secret: str) -> bytes:
    """Garante que qualquer string ou segredo seja convertido numa chave Fernet válida de 32 bytes em base64."""
    secret_bytes = raw_secret.strip().encode("utf-8")
    with contextlib.suppress(Exception):
        decoded = base64.urlsafe_b64decode(secret_bytes)
        if len(decoded) == 32:
            return secret_bytes
    # Derivação determinística de 32 bytes via SHA-256
    digest = hashlib.sha256(secret_bytes).digest()
    return base64.urlsafe_b64encode(digest)


class FieldCipher:
    """Responsável pela cifra e decifra simétrica de campos sensíveis com versionamento de token."""

    def __init__(self, key: bytes | str | None = None) -> None:
        resolved_key = self._resolve_key(key)
        self._fernet = Fernet(resolved_key)

    @staticmethod
    def _resolve_key(explicit_key: bytes | str | None) -> bytes:
        """Resolve a chave a partir do parâmetro explícito, variável de ambiente ou ficheiro em disco."""
        if explicit_key is not None:
            if isinstance(explicit_key, str):
                return _derive_fernet_key(explicit_key)
            return explicit_key

        env_key = os.getenv("ATHLETE_DATA_CIPHER_KEY")
        if env_key:
            return _derive_fernet_key(env_key)

        key_dir = APP_DATA_DIR / "keys"
        key_file = key_dir / "field_cipher.key"

        if key_file.exists():
            try:
                saved = key_file.read_text(encoding="utf-8").strip()
                if saved:
                    return _derive_fernet_key(saved)
            except OSError as exc:
                logger.warning("Falha ao ler chave persistida em %s: %s", key_file, exc)

        # Gerar nova chave e gravar localmente
        try:
            key_dir.mkdir(parents=True, exist_ok=True)
            new_key = Fernet.generate_key()
            key_file.write_bytes(new_key)
            # Em sistemas POSIX/Windows restringe permissões sempre que viável
            with contextlib.suppress(OSError):
                key_file.chmod(0o600)
            return new_key
        except OSError as exc:
            logger.warning("Não foi possível persistir a chave em disco (%s). Usando chave em memória temporária.", exc)
            return Fernet.generate_key()

    def encrypt(self, plaintext: str | None) -> str | None:
        """Cifra a string em claro, prefixando com 'enc:v1:'."""
        if plaintext is None:
            return None
        # Se já estiver cifrado, mantém idempotente
        if plaintext.startswith(CIPHER_PREFIX):
            return plaintext
        token = self._fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")
        return f"{CIPHER_PREFIX}{token}"

    def decrypt(self, ciphertext: str | None) -> str | None:
        """Decifra uma string cifrada. Se não contiver o prefixo 'enc:v1:', devolve o valor original (fallback)."""
        if ciphertext is None:
            return None
        if not ciphertext.startswith(CIPHER_PREFIX):
            return ciphertext
        token = ciphertext[len(CIPHER_PREFIX):]
        try:
            return self._fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except InvalidToken as err:
            logger.error("Falha ao decifrar campo: token corrompido ou chave incorreta.")
            raise ValueError("Token criptográfico inválido ou chave de decifra incompatível.") from err


_default_cipher: FieldCipher | None = None


def get_field_cipher() -> FieldCipher:
    """Retorna a instância singleton do cifrador de campos da aplicação."""
    global _default_cipher
    if _default_cipher is None:
        _default_cipher = FieldCipher()
    return _default_cipher


def set_field_cipher(cipher: FieldCipher | None) -> None:
    """Permite injetar uma instância customizada (útil em testes unitários)."""
    global _default_cipher
    _default_cipher = cipher


class EncryptedString(TypeDecorator[str]):
    """Tipo SQLAlchemy para Strings que são cifradas em repouso e transparentemente decifradas em memória."""

    impl = String
    cache_ok = True

    def __init__(self, length: int = 512, **kwargs: Any) -> None:
        super().__init__(length=length, **kwargs)

    def process_bind_param(self, value: str | None, dialect: Any) -> str | None:
        if value is None:
            return None
        return get_field_cipher().encrypt(str(value))

    def process_result_value(self, value: str | None, dialect: Any) -> str | None:
        if value is None:
            return None
        return get_field_cipher().decrypt(value)


class EncryptedText(TypeDecorator[str]):
    """Tipo SQLAlchemy para Textos longos cifrados em repouso (ex: JSON de landmarks)."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Any) -> str | None:
        if value is None:
            return None
        return get_field_cipher().encrypt(str(value))

    def process_result_value(self, value: str | None, dialect: Any) -> str | None:
        if value is None:
            return None
        return get_field_cipher().decrypt(value)
