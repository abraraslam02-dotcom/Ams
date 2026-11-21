import { formatAppDate } from './formatters';

/**
 * Enhances all native <input type="date"> elements across the application so that
 * their displayed value always renders in the standard dd-MMM-yy format (e.g. 21-Nov-26)
 * while preserving the underlying ISO YYYY-MM-DD value for React state, SQL queries,
 * and native calendar picker functionality.
 */
export function initGlobalDateInputFormatting(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const syncSingleDateInput = (input: HTMLInputElement) => {
    if (!input || input.type !== 'date') return;

    // Capture the element's original computed text color before applying transparent native text
    if (!input.classList.contains('ams-date-formatted')) {
      try {
        const computed = window.getComputedStyle(input);
        const textColor = computed.color;
        if (textColor && textColor !== 'rgba(0, 0, 0, 0)' && textColor !== 'transparent') {
          input.style.setProperty('--ams-date-color', textColor);
        }
      } catch {
        // fallback to CSS default
      }
      input.classList.add('ams-date-formatted');
    }

    const rawVal = (input.value || '').trim();
    const formatted = rawVal ? formatAppDate(rawVal, '') : '';
    const nextAttr = formatted || 'dd-mmm-yy';
    const isEmpty = !formatted;

    if (input.getAttribute('data-formatted-date') !== nextAttr) {
      input.setAttribute('data-formatted-date', nextAttr);
    }
    if (isEmpty) {
      if (!input.hasAttribute('data-date-empty')) {
        input.setAttribute('data-date-empty', 'true');
      }
    } else if (input.hasAttribute('data-date-empty')) {
      input.removeAttribute('data-date-empty');
    }
  };

  const syncAllDateInputs = () => {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]');
    for (let i = 0; i < inputs.length; i++) {
      syncSingleDateInput(inputs[i]);
    }
  };

  const handleEvent = (e: Event) => {
    const target = e.target;
    if (target instanceof HTMLInputElement && target.type === 'date') {
      syncSingleDateInput(target);
    }
  };

  let rafPending = false;
  const scheduleSyncAll = () => {
    if (rafPending) return;
    rafPending = true;
    window.requestAnimationFrame(() => {
      rafPending = false;
      syncAllDateInputs();
    });
  };

  const observer = new MutationObserver(() => {
    scheduleSyncAll();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['value', 'type', 'class'],
  });

  document.addEventListener('input', handleEvent, true);
  document.addEventListener('change', handleEvent, true);
  document.addEventListener('blur', handleEvent, true);
  document.addEventListener('focus', handleEvent, true);

  // Lightweight periodic sync catches programmatic React `.value = ...` updates that don't mutate DOM attributes
  const intervalId = window.setInterval(syncAllDateInputs, 250);

  // Initial pass
  syncAllDateInputs();

  return () => {
    observer.disconnect();
    document.removeEventListener('input', handleEvent, true);
    document.removeEventListener('change', handleEvent, true);
    document.removeEventListener('blur', handleEvent, true);
    document.removeEventListener('focus', handleEvent, true);
    window.clearInterval(intervalId);
  };
}
