import { describe, it, expect, beforeEach } from 'vitest';
import { SecureStorageService } from '@/services/secureStorage';

describe('SecureStorageService', () => {
  let storage;

  beforeEach(() => {
    storage = new SecureStorageService();
    window.localStorage.clear();
  });

  it('guarda e recupera objetos complexos em IndexedDB', async () => {
    const profile = { name: 'João Silva', weightKg: 75.5, shoeSizeEu: 42 };
    await storage.setItem('athleteProfile', profile);

    const retrieved = await storage.getItem('athleteProfile');
    expect(retrieved).toEqual(profile);

    await storage.removeItem('athleteProfile');
    const afterDelete = await storage.getItem('athleteProfile');
    expect(afterDelete).toBeNull();
  });

  it('migra dados legados de localStorage para secureStorage e remove a cópia do localStorage', async () => {
    const legacyProfile = { weightKg: 82, shoeSizeEu: 44, waistCm: 86 };
    const legacySession = { id: 'sess-123', angles: { knee: 148 } };

    window.localStorage.setItem('athleteMotion_athlete_profile', JSON.stringify(legacyProfile));
    window.localStorage.setItem('athleteMotion_baseline_session', JSON.stringify(legacySession));

    const migrationResult = await storage.migrateLegacyLocalStorage();
    expect(migrationResult.migratedCount).toBe(2);

    // Deve ter sido removido do localStorage
    expect(window.localStorage.getItem('athleteMotion_athlete_profile')).toBeNull();
    expect(window.localStorage.getItem('athleteMotion_baseline_session')).toBeNull();

    // Deve estar acessível no secureStorage
    const migratedProfile = await storage.getItem('athleteMotion_athlete_profile');
    expect(migratedProfile).toEqual(legacyProfile);

    const migratedSession = await storage.getItem('athleteMotion_baseline_session');
    expect(migratedSession).toEqual(legacySession);
  });
});
