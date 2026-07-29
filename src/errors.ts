/**
 * Typed error hierarchy for Interscript-TS.
 *
 * Hierarchy is intentionally shallow so callers can rescue a single base
 * class or a specific subclass without traversing a deep inheritance tree
 * (MECE: each error class has exactly one responsibility).
 */

export class InterscriptError extends Error {
  override readonly cause?: unknown

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
    this.cause = options?.cause
  }
}

export class MapNotFoundError extends InterscriptError {
  readonly systemCode: string
  constructor(systemCode: string) {
    super(`Map not found: ${systemCode}`)
    this.systemCode = systemCode
  }
}

export class SystemConversionError extends InterscriptError {}

export class MapLogicError extends InterscriptError {}

export class DependencyMissingError extends InterscriptError {
  readonly dependency: string
  constructor(dependency: string) {
    super(`Map dependency missing: ${dependency}`)
    this.dependency = dependency
  }
}
