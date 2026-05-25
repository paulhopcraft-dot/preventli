import { useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, initializeCsrf } from "./lib/queryClient";
import { Toaster } from "./components/ui/toaster";
import { TooltipProvider } from "./components/ui/tooltip";
import { ThemeProvider } from "./components/theme-provider";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GlobalChatWidget } from "./components/GlobalChatWidget";

// Loading component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

// Core components that are needed immediately (keep static imports)
import { RoleBasedDashboard } from "./components/RoleBasedDashboard";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";

// Dynamic imports for route-based code splitting
const AdminLayout = lazy(() => import("./components/admin/AdminLayout").then(m => ({ default: m.AdminLayout })));
const SessionsPage = lazy(() => import("./pages/SessionsPage"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const CompanyList = lazy(() => import("./pages/admin/CompanyList"));
const CompanyForm = lazy(() => import("./pages/admin/CompanyForm"));
const RolesList = lazy(() => import("./pages/admin/roles/RolesList"));
const RoleForm = lazy(() => import("./pages/admin/roles/RoleForm"));
const DutiesList = lazy(() => import("./pages/admin/duties/DutiesList"));
const DutyForm = lazy(() => import("./pages/admin/duties/DutyForm"));

const InboundEmailTriagePage = lazy(() => import("./pages/admin/InboundEmailTriagePage"));
const CompanySettings = lazy(() => import("./pages/CompanySettings"));
const CasesPage = lazy(() => import("./pages/CasesPage"));
const CaseSummaryPage = lazy(() => import("./pages/CaseSummaryPage"));
const NewClaimPage = lazy(() => import("./pages/NewClaimPage"));
const RTWPlannerPage = lazy(() => import("./pages/RTWPlannerPage"));
const RTWPlanPage = lazy(() => import("./pages/rtw/PlanPage"));
const CheckInsPage = lazy(() => import("./pages/CheckInsPage"));
const FinancialsPage = lazy(() => import("./pages/FinancialsPage"));
const PredictionsPage = lazy(() => import("./pages/PredictionsPage"));
const RiskDashboardPage = lazy(() => import("./pages/RiskDashboardPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const CertificateReviewPage = lazy(() => import("./pages/CertificateReviewPage"));
const InjuryDateReviewPage = lazy(() => import("./pages/InjuryDateReviewPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const EmployerCaseDetailPage = lazy(() => import("./pages/EmployerCaseDetailPage"));
const EmployerNewCasePage = lazy(() => import("./pages/EmployerNewCasePage"));
const EmployerCaseSuccessPage = lazy(() => import("./pages/EmployerCaseSuccessPage"));
const EmployerDashboardPage = lazy(() => import("./pages/EmployerDashboardPage"));
const HRDecisionsPage = lazy(() => import("./pages/HRDecisionsPage"));
const PreEmploymentPage = lazy(() => import("./pages/PreEmploymentPage"));
const UnifiedCaseWorkspace = lazy(() => import("./pages/UnifiedCaseWorkspace"));
const LifecycleDashboard = lazy(() => import("./pages/LifecycleDashboard"));
const PreEmploymentForm = lazy(() => import("./pages/PreEmploymentForm"));
const PreventionAssessmentForm = lazy(() => import("./pages/PreventionAssessmentForm"));
const InjuryAssessmentForm = lazy(() => import("./pages/InjuryAssessmentForm"));
const ChecksPage = lazy(() => import("./pages/ChecksPage"));
const ComprehensiveRTWForm = lazy(() => import("./pages/ComprehensiveRTWForm"));
const RTWAssessmentWizard = lazy(() => import("./pages/RTWAssessmentWizard"));
const GeneralWellnessForm = lazy(() => import("./pages/GeneralWellnessForm"));
const MentalHealthForm = lazy(() => import("./pages/MentalHealthForm"));
const ExitHealthCheckForm = lazy(() => import("./pages/ExitHealthCheckForm"));
const ExitProcessingPage = lazy(() => import("./pages/ExitProcessingPage"));
const MarketingDocsPage = lazy(() => import("./pages/MarketingDocsPage"));
const AgentJobsPage = lazy(() => import("./pages/AgentJobsPage"));
const ControlTowerPage = lazy(() => import("./pages/ControlTowerPage"));
const WorkerProfile = lazy(() => import("./pages/WorkerProfile"));
const WorkersListPage = lazy(() => import("./pages/WorkersListPage"));
const NewAssessmentPage = lazy(() => import("./pages/NewAssessmentPage"));
const AssessmentDetailPage = lazy(() => import("./pages/AssessmentDetailPage"));
const HelpCenterPage = lazy(() => import("./pages/HelpCenterPage"));
const PartnerClientPicker = lazy(() => import("./pages/PartnerWorkspace"));
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage"));

// LogoutRedirect component - triggers logout and redirects to login
function LogoutRedirect() {
  const { logout, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      logout();
    }
  }, [isAuthenticated, logout]);

  // Wait for auth state to settle before redirecting
  // This prevents a race condition where LoginPage sees authenticated user and redirects back to /
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Only navigate to login after logout is complete (isAuthenticated is false)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Still authenticated, logout in progress - show loading
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-foreground">Page not found</h1>
        <p className="mt-2 text-muted-foreground">
          The page you requested does not exist or may have moved.
        </p>
        <a className="mt-6 inline-flex text-primary underline" href="/">
          Return to dashboard
        </a>
      </div>
    </div>
  );
}

export default function App() {
  // Initialize CSRF token on app mount
  useEffect(() => {
    initializeCsrf();
  }, []);

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeProvider defaultTheme="light">
            <AuthProvider>
              <ErrorBoundary label="Application">
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  {/* Public routes — no authentication required */}
                  <Route
                    path="/check/:token"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <PreEmploymentForm />
                      </Suspense>
                    }
                  />

                  {/* Authentication routes - no lazy loading needed */}
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />


                  {/* Main dashboard - immediate load */}
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <RoleBasedDashboard />
                      </ProtectedRoute>
                    }
                  />

                  {/* Lazy-loaded routes */}
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <CompanySettings />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/sessions"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <SessionsPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/cases"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <CasesPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/workspace"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <UnifiedCaseWorkspace />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/lifecycle"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <LifecycleDashboard />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/pre-employment-form"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <PreEmploymentForm />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/prevention-assessment-form"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <PreventionAssessmentForm />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/injury-assessment-form"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <InjuryAssessmentForm />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/comprehensive-rtw-form"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <ComprehensiveRTWForm />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/cases/:id/rtw-wizard"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <RTWAssessmentWizard />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/wellness-form"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <GeneralWellnessForm />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/mental-health-form"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <MentalHealthForm />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/exit-health-check-form"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <ExitHealthCheckForm />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/cases/:id/workspace"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <UnifiedCaseWorkspace />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/summary/:id"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <CaseSummaryPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/employer/case/:id"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <EmployerCaseDetailPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/employer/new-case"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <EmployerNewCasePage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/employer/case/:id/success"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <EmployerCaseSuccessPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/employer"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <EmployerDashboardPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/hr/decisions"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <HRDecisionsPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/logout" element={<LogoutRedirect />} />
                  <Route
                    path="/claims/new"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <NewClaimPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/rtw-planner"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <RTWPlannerPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/rtw/plans/:planId"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <RTWPlanPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/pre-employment"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <PreEmploymentPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/checks"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <ChecksPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/exit-processing"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <ExitProcessingPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/marketing-docs"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <MarketingDocsPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/checkins"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <CheckInsPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/financials"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <FinancialsPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/predictions"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <PredictionsPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/risk"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <RiskDashboardPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/audit"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <AuditLogPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/agents"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <AgentJobsPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/certificates/review"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <CertificateReviewPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/injury-dates/review"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <InjuryDateReviewPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/reports"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <ReportsPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />

                  {/* Admin Routes */}
                  <Route
                    path="/admin"
                    element={
                      <AdminRoute>
                        <Suspense fallback={<PageLoader />}>
                          <AdminLayout />
                        </Suspense>
                      </AdminRoute>
                    }
                  >
                    <Route
                      index
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <AdminDashboard />
                        </Suspense>
                      }
                    />
                    <Route
                      path="companies"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <CompanyList />
                        </Suspense>
                      }
                    />
                    <Route
                      path="companies/new"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <CompanyForm />
                        </Suspense>
                      }
                    />
                    <Route
                      path="companies/:id"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <CompanyForm />
                        </Suspense>
                      }
                    />
                    <Route
                      path="roles"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <RolesList />
                        </Suspense>
                      }
                    />
                    <Route
                      path="roles/new"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <RoleForm />
                        </Suspense>
                      }
                    />
                    <Route
                      path="roles/:id"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <RoleForm />
                        </Suspense>
                      }
                    />
                    <Route
                      path="roles/:roleId/duties"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <DutiesList />
                        </Suspense>
                      }
                    />
                    <Route
                      path="roles/:roleId/duties/new"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <DutyForm />
                        </Suspense>
                      }
                    />
                    <Route
                      path="roles/:roleId/duties/:dutyId"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <DutyForm />
                        </Suspense>
                      }
                    />
                    <Route
                      path="control-tower"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <ControlTowerPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="inbound-emails"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <InboundEmailTriagePage />
                        </Suspense>
                      }
                    />
                  </Route>

                  {/* Workers List — searchable table of all workers */}
                  <Route
                    path="/workers-list"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <WorkersListPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />

                  {/* Worker Profile */}
                  <Route
                    path="/workers/:id"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <WorkerProfile />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />

                  {/* New Assessment — employer sends magic link to worker */}
                  <Route
                    path="/assessments/new"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <NewAssessmentPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />

                  {/* Assessment Detail */}
                  <Route
                    path="/assessments/:id"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <AssessmentDetailPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />

                  {/* Help Centre */}
                  <Route
                    path="/help"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <HelpCenterPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />

                  {/* Partner-tier: client picker + self-service password change */}
                  <Route
                    path="/partner/clients"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <PartnerClientPicker />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/change-password"
                    element={
                      <ProtectedRoute>
                        <Suspense fallback={<PageLoader />}>
                          <ChangePasswordPage />
                        </Suspense>
                      </ProtectedRoute>
                    }
                  />

                  {/* Alias: /employer/dashboard → /employer (common URL in QA/external links) */}
                  <Route
                    path="/employer/dashboard"
                    element={<Navigate to="/employer" replace />}
                  />

                  {/* Catch-all: render NotFoundPage for unknown paths */}
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
              </ErrorBoundary>
              <GlobalChatWidget />
              <Toaster />
            </AuthProvider>
          </ThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
