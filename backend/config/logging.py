"""
Configuración de logging centralizada para Realm Keeper
Proporciona un logger configurado que registra en consola y archivos
"""

import logging
import sys
from pathlib import Path
from typing import Optional


def setup_logging(log_level: str = "INFO", log_dir: Optional[Path] = None) -> logging.Logger:
    """
    Configurar logging estructurado para la aplicación
    
    Args:
        log_level: Nivel de logging (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_dir: Directorio para archivos de log. Si es None, solo log en consola
    
    Returns:
        Logger configurado para usar en la aplicación
    """
    
    # Validar nivel
    log_level = log_level.upper()
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    if log_level not in valid_levels:
        log_level = "INFO"
    
    # Crear logger
    logger = logging.getLogger("realm_keeper")
    logger.setLevel(getattr(logging, log_level))
    
    # Evitar duplicados si ya hay handlers
    if logger.handlers:
        logger.handlers.clear()
    
    # Formato de log
    formatter = logging.Formatter(
        fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Handler para consola (siempre activo)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, log_level))
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # Handler para archivo (solo en DEBUG o si log_dir especificado)
    if log_dir:
        log_dir.mkdir(parents=True, exist_ok=True)
        
        # Archivo principal de la aplicación
        app_log_file = log_dir / "app.log"
        file_handler = logging.FileHandler(app_log_file)
        file_handler.setLevel(getattr(logging, log_level))
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        
        # Archivo de errores separado
        error_log_file = log_dir / "error.log"
        error_handler = logging.FileHandler(error_log_file)
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(formatter)
        logger.addHandler(error_handler)
    
    return logger


def get_logger(name: str) -> logging.Logger:
    """
    Obtener un logger con nombre específico (para módulos)
    
    Args:
        name: Nombre del logger (típicamente __name__)
    
    Returns:
        Logger configurado
    """
    return logging.getLogger(f"realm_keeper.{name}")
