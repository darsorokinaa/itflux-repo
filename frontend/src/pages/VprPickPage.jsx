import { useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import SubjectSelector from "../components/SubjectSelector";

function mapSubjectToPath(id) {
  if (id === "info") return "inf";
  return id;
}

function VprPickPage() {
  const navigate = useNavigate();

  useLayoutEffect(() => {
    document.body.classList.add("subject-page", "vpr-pick-page");
    return () => document.body.classList.remove("subject-page", "vpr-pick-page");
  }, []);

  return (
    <div className="subject-page vpr-pick-page">
      <div className="container subject-page-container py-8 md:py-10">
        <SubjectSelector
          onContinue={({ selectedClass, selectedSubject, advancedLevel }) => {
            const sub = mapSubjectToPath(selectedSubject);
            const q = new URLSearchParams();
            q.set("grade", String(selectedClass));
            if (advancedLevel) q.set("advanced", "1");
            navigate(`/vpr/${sub}?${q.toString()}`);
          }}
        />
      </div>
    </div>
  );
}

export default VprPickPage;
