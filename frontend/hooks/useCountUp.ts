import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Easing function for smooth deceleration (ease-out cubic)
 */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Formats a number with commas for thousands
 */
const formatNumber = (value: number): string => {
  return Math.round(value).toLocaleString();
};

interface UseCountUpOptions {
  duration?: number;
  suffix?: string;
  delay?: number;
}

interface UseCountUpReturn {
  animatedValue: string;
  isAnimating: boolean;
  elementRef: RefObject<HTMLElement | null>;
}

/**
 * Hook that animates a number from 0 to target when the element enters viewport.
 * Uses requestAnimationFrame for 60fps performance and IntersectionObserver for visibility.
 *
 * @param target - The final number value to count up to
 * @param options - Configuration options
 * @returns Object containing formatted animated string, animation state, and element ref to attach
 */
export default function useCountUp(
  target: number,
  options: UseCountUpOptions = {}
): UseCountUpReturn {
  const { duration = 1500, suffix = "", delay = 0 } = options;

  const [animatedValue, setAnimatedValue] = useState<string>(
    suffix ? `0${suffix}` : "0"
  );
  const [isAnimating, setIsAnimating] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const hasAnimatedRef = useRef<boolean>(false);
  const delayTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Prevent re-animation if already completed
    if (hasAnimatedRef.current) return;

    let isMounted = true;

    const startAnimation = () => {
      if (!hasAnimatedRef.current || isAnimating) return;

      setIsAnimating(true);
      startTimeRef.current = null;

      const animate = (timestamp: number) => {
        if (!isMounted) return;

        if (!startTimeRef.current) {
          startTimeRef.current = timestamp;
        }

        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);

        // Apply easing
        const easedProgress = easeOutCubic(progress);

        // Calculate current value
        const current = easedProgress * target;

        // Format and update
        setAnimatedValue(`${formatNumber(current)}${suffix}`);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          // Ensure final value is exact
          setAnimatedValue(`${formatNumber(target)}${suffix}`);
          setIsAnimating(false);
          hasAnimatedRef.current = true;
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    };

    const stopAnimation = () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (delayTimeoutRef.current) {
        clearTimeout(delayTimeoutRef.current);
        delayTimeoutRef.current = null;
      }
    };

    // Set up IntersectionObserver
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Apply delay if specified
            if (delay > 0) {
              delayTimeoutRef.current = window.setTimeout(() => {
                if (isMounted) startAnimation();
              }, delay);
            } else {
              startAnimation();
            }
            // Unobserve after first trigger
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.3,
        rootMargin: "0px",
      }
    );

    const element = elementRef.current;
    if (element) {
      observer.observe(element);
    }

    return () => {
      isMounted = false;
      stopAnimation();
      observer.disconnect();
    };
    // Only re-run if fundamental parameters change, not on animation state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, suffix, delay]);

  return { animatedValue, isAnimating, elementRef };
}
