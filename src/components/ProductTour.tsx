import { useEffect, useState, useRef } from 'react'
import { IconSparkles, IconX, IconArrowLeft, IconArrowRight, IconCheck, IconRocket, IconClock, IconChartBar, IconUsers } from '@tabler/icons-react'

export interface TourStep {
  target: string // CSS selector for element to highlight
  title: string
  description: string
  highlight?: string // Optional highlight box content
  icon?: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
}

const TOUR_STEPS: TourStep[] = [
  {
    target: 'body',
    title: 'Welcome to HRS Desktop! 🎉',
    description: 'Let\'s take a quick tour to show you around. This will only take a minute and will help you get the most out of the app.',
    icon: <IconRocket size={24} />,
    position: 'bottom',
    highlight: '💡 You can restart this tour anytime by clicking the help button'
  },
  {
    target: '.budget-row:first-child',
    title: 'Project Cards',
    description: 'Each card shows a project with real-time budget tracking. Click to expand and see detailed tasks and worklogs.',
    icon: <IconChartBar size={24} />,
    position: 'bottom',
    highlight: '🎨 Cards change color based on budget status: Green (on track), Yellow (watch), Orange (at risk), Red (over budget)'
  },
  {
    target: '.budget-row:first-child .project-name',
    title: 'Project Information',
    description: 'See project name, hours spent vs estimated, and completion percentage at a glance. The status icon shows current health.',
    icon: <IconClock size={24} />,
    position: 'bottom'
  },
  {
    target: '.budget-row:first-child .project-meta',
    title: 'Team Contributors',
    description: 'This shows all team members working on the project with their logged hours. Data loads instantly from Jira worklogs.',
    icon: <IconUsers size={24} />,
    position: 'bottom',
    highlight: '⚡ All data is cached for instant loading'
  },
  {
    target: '.budget-progress',
    title: 'Visual Progress Bar',
    description: 'The color-coded progress bar gives you instant visual feedback on project health. Hover over it to see more details.',
    position: 'top',
    highlight: '✨ Progress bars have beautiful gradients that match the status colors'
  }
]

interface ProductTourProps {
  onComplete?: () => void
  onSkip?: () => void
}

export function ProductTour({ onComplete, onSkip }: ProductTourProps) {
  const [isActive, setIsActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [spotlightPosition, setSpotlightPosition] = useState({ top: 0, left: 0, width: 0, height: 0 })
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const isScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<number>()

  useEffect(() => {
    // Tour is disabled on auto-start - users must click the FAB button to start
    // Uncomment below to enable auto-start for new users:
    /*
    const tourCompleted = localStorage.getItem('hrs-tour-completed')
    const tourSkipped = localStorage.getItem('hrs-tour-skipped')
    
    if (!tourCompleted && !tourSkipped) {
      setTimeout(() => setIsActive(true), 2000)
    }
    */
  }, [])

  useEffect(() => {
    if (!isActive) return

    const updatePositions = () => {
      // Prevent updates while scrolling
      if (isScrollingRef.current) return

      const step = TOUR_STEPS[currentStep]
      const targetElement = document.querySelector(step.target)

      if (targetElement) {
        const rect = targetElement.getBoundingClientRect()
        
        // Update spotlight
        setSpotlightPosition({
          top: rect.top - 8,
          left: rect.left - 8,
          width: rect.width + 16,
          height: rect.height + 16
        })

        // Calculate tooltip position
        const tooltipWidth = 400
        const tooltipHeight = tooltipRef.current?.offsetHeight || 300
        const padding = 20

        let tooltipTop = 0
        let tooltipLeft = 0

        switch (step.position) {
          case 'bottom':
            tooltipTop = rect.bottom + padding
            tooltipLeft = rect.left + (rect.width / 2) - (tooltipWidth / 2)
            break
          case 'top':
            tooltipTop = rect.top - tooltipHeight - padding
            tooltipLeft = rect.left + (rect.width / 2) - (tooltipWidth / 2)
            break
          case 'left':
            tooltipTop = rect.top + (rect.height / 2) - (tooltipHeight / 2)
            tooltipLeft = rect.left - tooltipWidth - padding
            break
          case 'right':
            tooltipTop = rect.top + (rect.height / 2) - (tooltipHeight / 2)
            tooltipLeft = rect.right + padding
            break
          default:
            tooltipTop = rect.bottom + padding
            tooltipLeft = rect.left + (rect.width / 2) - (tooltipWidth / 2)
        }

        // Keep tooltip on screen
        tooltipLeft = Math.max(padding, Math.min(window.innerWidth - tooltipWidth - padding, tooltipLeft))
        tooltipTop = Math.max(padding, Math.min(window.innerHeight - tooltipHeight - padding, tooltipTop))

        setTooltipPosition({ top: tooltipTop, left: tooltipLeft })
      }
    }

    const handleScroll = () => {
      // Debounce scroll updates
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current)
      }
      
      isScrollingRef.current = true
      
      scrollTimeoutRef.current = window.setTimeout(() => {
        isScrollingRef.current = false
        updatePositions()
      }, 100)
    }

    // Initial position update
    updatePositions()

    // Scroll element into view ONCE when step changes
    const step = TOUR_STEPS[currentStep]
    const targetElement = document.querySelector(step.target)
    if (targetElement && step.target !== 'body') {
      isScrollingRef.current = true
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => {
        isScrollingRef.current = false
      }, 1000)
    }

    // Add listeners
    window.addEventListener('resize', updatePositions)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('resize', updatePositions)
      window.removeEventListener('scroll', handleScroll, true)
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [isActive, currentStep])

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleComplete()
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSkip = () => {
    setIsActive(false)
    localStorage.setItem('hrs-tour-skipped', 'true')
    onSkip?.()
  }

  const handleComplete = () => {
    setIsActive(false)
    localStorage.setItem('hrs-tour-completed', 'true')
    onComplete?.()
    
    // Show success message
    const message = document.createElement('div')
    message.className = 'success-message'
    message.innerHTML = `
      <div class="success-icon">✓</div>
      <span>🎉 Tour completed! You're all set to get started.</span>
    `
    document.body.appendChild(message)
    setTimeout(() => message.remove(), 3000)
  }

  const handleRestart = () => {
    setCurrentStep(0)
    setIsActive(true)
    localStorage.removeItem('hrs-tour-completed')
    localStorage.removeItem('hrs-tour-skipped')
  }

  if (!isActive) {
    // Always show FAB to start/restart tour
    return (
      <button
        className="start-tour-fab"
        onClick={handleRestart}
        title="Start product tour"
        aria-label="Start product tour"
      >
        <IconSparkles size={28} />
      </button>
    )
  }

  const step = TOUR_STEPS[currentStep]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === TOUR_STEPS.length - 1

  return (
    <>
      {/* Overlay */}
      <div className="tour-overlay" onClick={handleSkip} />

      {/* Spotlight */}
      <div
        className="tour-spotlight"
        style={{
          top: `${spotlightPosition.top}px`,
          left: `${spotlightPosition.left}px`,
          width: `${spotlightPosition.width}px`,
          height: `${spotlightPosition.height}px`
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="tour-tooltip"
        data-position={step.position || 'bottom'}
        style={{
          top: `${tooltipPosition.top}px`,
          left: `${tooltipPosition.left}px`
        }}
      >
        {/* Header */}
        <div className="tour-header">
          <div className="tour-step-badge">
            STEP {currentStep + 1} OF {TOUR_STEPS.length}
          </div>
          <h2 className="tour-title">
            {step.icon && <span style={{ marginRight: '8px', verticalAlign: 'middle' }}>{step.icon}</span>}
            {step.title}
          </h2>
        </div>

        {/* Body */}
        <div className="tour-body">
          <p className="tour-description">{step.description}</p>
          
          {step.highlight && (
            <div className="tour-highlight">
              <span className="tour-highlight-icon">💡</span>
              {step.highlight}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tour-footer">
          {/* Progress dots */}
          <div className="tour-progress">
            {TOUR_STEPS.map((_, index) => (
              <div
                key={index}
                className={`tour-progress-dot ${
                  index === currentStep ? 'active' : index < currentStep ? 'completed' : ''
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="tour-actions">
            <button className="tour-btn tour-btn-skip" onClick={handleSkip}>
              Skip
            </button>
            
            {!isFirstStep && (
              <button className="tour-btn tour-btn-prev" onClick={handlePrev}>
                <IconArrowLeft size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                Back
              </button>
            )}
            
            <button
              className={`tour-btn ${isLastStep ? 'tour-btn-finish' : 'tour-btn-next'}`}
              onClick={handleNext}
            >
              {isLastStep ? (
                <>
                  Finish
                  <IconCheck size={16} style={{ marginLeft: '4px', verticalAlign: 'middle' }} />
                </>
              ) : (
                <>
                  Next
                  <IconArrowRight size={16} style={{ marginLeft: '4px', verticalAlign: 'middle' }} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// Hook for showing contextual tips
export function useContextualTip(elementId: string, tipText: string, condition: boolean = true) {
  useEffect(() => {
    if (!condition) return

    const element = document.getElementById(elementId)
    if (!element) return

    const tip = document.createElement('div')
    tip.className = 'contextual-tip'
    tip.textContent = tipText
    
    const rect = element.getBoundingClientRect()
    tip.style.top = `${rect.top - 40}px`
    tip.style.left = `${rect.left + rect.width / 2}px`
    tip.style.transform = 'translateX(-50%)'

    document.body.appendChild(tip)

    const timeout = setTimeout(() => {
      tip.style.opacity = '0'
      setTimeout(() => tip.remove(), 300)
    }, 3000)

    return () => {
      clearTimeout(timeout)
      tip.remove()
    }
  }, [elementId, tipText, condition])
}

// Component for feature badges
export function FeatureBadge({ show = true }: { show?: boolean }) {
  if (!show) return null
  
  return (
    <div className="feature-badge" title="New feature!">
      ✨
    </div>
  )
}

