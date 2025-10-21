/**
 * Utilidades para mejorar la experiencia móvil
 */

// Toast notifications para feedback en móvil
function showToast(message, type = 'info', duration = 3000) {
  // Remover toasts existentes
  const existingToasts = document.querySelectorAll('.toast');
  existingToasts.forEach(toast => toast.remove());
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Mostrar toast con animación
  setTimeout(() => {
    toast.classList.add('show');
  }, 100);
  
  // Remover toast después del tiempo especificado
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, duration);
}

// Mostrar loading state en botones
function showButtonLoading(button, originalText) {
  if (button.dataset.originalText) return; // Ya está en loading
  
  button.dataset.originalText = originalText || button.innerHTML;
  button.innerHTML = '<span class="spinner"></span> Procesando...';
  button.disabled = true;
  button.style.opacity = '0.7';
}

// Restaurar estado normal del botón
function hideButtonLoading(button) {
  if (!button.dataset.originalText) return; // No está en loading
  
  button.innerHTML = button.dataset.originalText;
  button.disabled = false;
  button.style.opacity = '1';
  delete button.dataset.originalText;
}

// Detectar si es dispositivo móvil
function isMobileDevice() {
  return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Detectar si es dispositivo táctil
function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// Mejorar inputs para móvil
function optimizeInputsForMobile() {
  const inputs = document.querySelectorAll('input, select, textarea');
  
  inputs.forEach(input => {
    // Agregar clases para estilos móviles
    if (isMobileDevice()) {
      input.classList.add('mobile-optimized');
    }
    
    // Prevenir zoom en iOS cuando el font-size es menor a 16px
    if (input.type === 'email' || input.type === 'tel' || input.type === 'url') {
      input.style.fontSize = '16px';
    }
    
    // Agregar inputmode apropiado
    switch (input.type) {
      case 'email':
        input.setAttribute('inputmode', 'email');
        break;
      case 'tel':
        input.setAttribute('inputmode', 'tel');
        break;
      case 'number':
        input.setAttribute('inputmode', 'numeric');
        break;
      case 'url':
        input.setAttribute('inputmode', 'url');
        break;
    }
    
    // Mejorar autocomplete
    if (input.type === 'email') {
      input.setAttribute('autocomplete', 'email');
    }
    if (input.type === 'tel') {
      input.setAttribute('autocomplete', 'tel');
    }
  });
}

// Hacer tablas responsivas
function makeTablesResponsive() {
  const tables = document.querySelectorAll('table:not(.responsive-table)');
  
  tables.forEach(table => {
    // Agregar clase responsiva
    table.classList.add('responsive-table');
    
    // Agregar wrapper si no existe
    if (!table.parentElement.classList.contains('table-container')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-container';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
    
    // Agregar data-labels para vista móvil
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const rows = table.querySelectorAll('tbody tr');
    
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      cells.forEach((cell, index) => {
        if (headers[index]) {
          cell.setAttribute('data-label', headers[index]);
        }
      });
    });
  });
}

// Optimizar formularios para tacto
function optimizeFormsForTouch() {
  const forms = document.querySelectorAll('form');
  
  forms.forEach(form => {
    // Agregar clase móvil
    if (isMobileDevice()) {
      form.classList.add('mobile-form');
    }
    
    // Mejorar botones de submit
    const submitBtns = form.querySelectorAll('button[type="submit"], input[type="submit"]');
    submitBtns.forEach(btn => {
      btn.classList.add('touch-btn');
      
      // Agregar loading state en submit
      form.addEventListener('submit', (e) => {
        if (!btn.disabled) {
          showButtonLoading(btn);
          
          // Restaurar después de un tiempo si no se maneja externamente
          setTimeout(() => {
            hideButtonLoading(btn);
          }, 5000);
        }
      });
    });
    
    // Mejorar validación para móvil
    const requiredInputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    requiredInputs.forEach(input => {
      input.addEventListener('invalid', (e) => {
        e.preventDefault();
        const message = input.validationMessage || 'Este campo es requerido';
        showToast(message, 'error');
        input.focus();
      });
    });
  });
}

// Mejoras de scroll para móvil
function optimizeScrollForMobile() {
  // Smooth scroll para navegación
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
  
  // Scroll horizontal para elementos que lo necesiten
  const scrollableElements = document.querySelectorAll('.table-container, .plates, .export-group');
  scrollableElements.forEach(element => {
    if (isTouchDevice()) {
      element.style.webkitOverflowScrolling = 'touch';
    }
  });
}

// Mejorar feedback táctil
function enhanceTouchFeedback() {
  const touchElements = document.querySelectorAll('button, .btn, input[type="button"], input[type="submit"]');
  
  touchElements.forEach(element => {
    // Agregar efecto ripple o feedback visual
    element.addEventListener('touchstart', function() {
      this.style.transform = 'scale(0.98)';
      this.style.transition = 'transform 0.1s ease';
    });
    
    element.addEventListener('touchend', function() {
      this.style.transform = 'scale(1)';
    });
    
    element.addEventListener('touchcancel', function() {
      this.style.transform = 'scale(1)';
    });
  });
}

// Gestión de vista previa en móviles
function manageMobilePreview() {
  if (!isMobileDevice()) return;
  
  const sheetOverview = document.querySelector('.sheet-overview');
  if (!sheetOverview) return;
  
  // Forzar ocultado en móviles con múltiples métodos
  sheetOverview.style.display = 'none';
  sheetOverview.style.visibility = 'hidden';
  sheetOverview.style.height = '0';
  sheetOverview.style.overflow = 'hidden';
  sheetOverview.style.margin = '0';
  sheetOverview.style.padding = '0';
  sheetOverview.classList.add('mobile-hidden');
  
  // Crear botón toggle si no existe
  let toggleBtn = document.querySelector('.mobile-preview-toggle');
  if (!toggleBtn) {
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'mobile-preview-toggle';
    toggleBtn.textContent = '👁️ Mostrar vista previa de placa';
    toggleBtn.type = 'button';
    
    // Insertar antes de la sección de vista previa
    sheetOverview.parentNode.insertBefore(toggleBtn, sheetOverview);
    
    // Event listener para toggle
    toggleBtn.addEventListener('click', function() {
      const isVisible = !sheetOverview.classList.contains('mobile-hidden');
      
      if (isVisible) {
        // Ocultar vista previa
        sheetOverview.style.display = 'none';
        sheetOverview.style.visibility = 'hidden';
        sheetOverview.style.height = '0';
        sheetOverview.style.overflow = 'hidden';
        sheetOverview.style.margin = '0';
        sheetOverview.style.padding = '0';
        sheetOverview.classList.add('mobile-hidden');
        sheetOverview.classList.remove('mobile-visible');
        this.textContent = '👁️ Mostrar vista previa de placa';
        showToast('Vista previa oculta para ahorrar espacio', 'info', 2000);
      } else {
        // Mostrar vista previa
        sheetOverview.style.display = 'block';
        sheetOverview.style.visibility = 'visible';
        sheetOverview.style.height = 'auto';
        sheetOverview.style.overflow = 'visible';
        sheetOverview.style.margin = '16px 0 0 0';
        sheetOverview.style.padding = '12px';
        sheetOverview.classList.remove('mobile-hidden');
        sheetOverview.classList.add('mobile-visible');
        this.textContent = '🙈 Ocultar vista previa';
        showToast('Vista previa visible', 'success', 2000);
        
        // Scroll suave hacia la vista previa
        setTimeout(() => {
          sheetOverview.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }, 100);
      }
    });
  }
}
// Mejorar accesibilidad en móvil
function enhanceMobileAccessibility() {
  // Asegurar que los elementos tocables tengan tamaño mínimo
  const touchTargets = document.querySelectorAll('button, .btn, a, input, select, textarea');
  touchTargets.forEach(target => {
    const rect = target.getBoundingClientRect();
    if (rect.width < 44 || rect.height < 44) {
      target.style.minWidth = '44px';
      target.style.minHeight = '44px';
    }
  });
  
  // Mejorar contraste en elementos pequeños
  const smallText = document.querySelectorAll('.hint-inline, .limit-note, small');
  smallText.forEach(text => {
    if (isMobileDevice()) {
      text.style.fontSize = '14px';
      text.style.lineHeight = '1.4';
    }
  });
}

// Gestión de orientación de dispositivo
function handleOrientationChange() {
  window.addEventListener('orientationchange', function() {
    // Esperar a que la orientación cambie completamente
    setTimeout(() => {
      // Recalcular layouts que puedan verse afectados
      const event = new Event('resize');
      window.dispatchEvent(event);
      
      // Scroll to top para evitar problemas de viewport
      if (isMobileDevice()) {
        window.scrollTo(0, 0);
      }
    }, 100);
  });
}

// Prevenir zoom accidental en doble tap
function preventAccidentalZoom() {
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, false);
}

// Inicialización de todas las mejoras móviles
function initMobileOptimizations() {
  // Solo aplicar en dispositivos móviles o táctiles
  if (!isMobileDevice() && !isTouchDevice()) {
    return;
  }
  
  console.log('🔧 Inicializando optimizaciones para móvil...');
  
  try {
    optimizeInputsForMobile();
    makeTablesResponsive();
    optimizeFormsForTouch();
    optimizeScrollForMobile();
    enhanceTouchFeedback();
    enhanceMobileAccessibility();
    handleOrientationChange();
    preventAccidentalZoom();
    manageMobilePreview(); // Gestionar vista previa en móviles
    
    console.log('✅ Optimizaciones móviles aplicadas correctamente');
    
    // Mostrar toast de bienvenida en móvil
    if (isMobileDevice()) {
      setTimeout(() => {
        showToast('¡Interfaz optimizada para móvil! 📱', 'success', 2000);
      }, 1000);
    }
  } catch (error) {
    console.error('❌ Error al aplicar optimizaciones móviles:', error);
  }
}

// Función para ocultar vista previa inmediatamente
function hidePreviewImmediately() {
  if (!isMobileDevice()) return;
  
  const sheetOverview = document.querySelector('.sheet-overview');
  if (sheetOverview) {
    sheetOverview.style.display = 'none';
    sheetOverview.style.visibility = 'hidden';
    sheetOverview.style.height = '0';
    sheetOverview.style.overflow = 'hidden';
    sheetOverview.classList.add('mobile-hidden');
    console.log('🔒 Vista previa oculta inmediatamente en móvil');
  }
}

// Ejecutar inmediatamente si es móvil
hidePreviewImmediately();

// Event listeners para inicialización
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    hidePreviewImmediately(); // Ejecutar de nuevo por si acaso
    initMobileOptimizations();
  });
} else {
  hidePreviewImmediately(); // Ejecutar de nuevo por si acaso
  initMobileOptimizations();
}

// También ejecutar cuando se carguen nuevos elementos dinámicamente
const observer = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Re-aplicar optimizaciones a nuevos elementos
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) { // Element node
          // Re-optimizar solo los nuevos elementos
          const newInputs = node.querySelectorAll ? node.querySelectorAll('input, select, textarea') : [];
          newInputs.forEach(input => {
            if (input.type === 'email' || input.type === 'tel' || input.type === 'url') {
              input.style.fontSize = '16px';
            }
          });
          
          const newTables = node.querySelectorAll ? node.querySelectorAll('table:not(.responsive-table)') : [];
          if (newTables.length > 0) {
            makeTablesResponsive();
          }
        }
      });
    }
  });
});

// Observar cambios en el DOM
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Exportar funciones para uso global
window.mobileUtils = {
  showToast,
  showButtonLoading,
  hideButtonLoading,
  isMobileDevice,
  isTouchDevice,
  optimizeInputsForMobile,
  makeTablesResponsive,
  optimizeFormsForTouch,
  manageMobilePreview,
  initMobileOptimizations
};